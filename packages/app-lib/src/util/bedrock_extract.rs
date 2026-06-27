use crate::event::emit::{emit_loading, edit_loading};
use crate::event::{LoadingBarId, LoadingBarType};
use crate::ErrorKind;
use std::path::{Path, PathBuf};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

pub async fn extract_bedrock_package(
    package_path: PathBuf,
    target_dir: PathBuf,
    loading_bar: &LoadingBarId,
    profile_name: &str,
    profile_path: &str,
) -> crate::Result<()> {
    if target_dir.exists() {
        return Ok(());
    }

    tokio::fs::create_dir_all(&target_dir).await?;

    let _ = edit_loading(
        loading_bar,
        LoadingBarType::MinecraftDownload {
            profile_name: profile_name.to_string(),
            profile_path: profile_path.to_string(),
        },
        100.0,
        "Распаковка пакета...",
    ).await;

    let is_msixvc = package_path.extension().and_then(|e| e.to_str()) == Some("msixvc");

    if is_msixvc {
        extract_msixvc(package_path, target_dir, loading_bar).await?;
    } else {
        extract_zip(package_path, target_dir, loading_bar).await?;
    }

    Ok(())
}

async fn extract_zip(
    package_path: PathBuf,
    target_dir: PathBuf,
    loading_bar: &LoadingBarId,
) -> crate::Result<()> {
    let loading_bar = loading_bar.clone();
    
    tokio::task::spawn_blocking(move || -> crate::Result<()> {
        let file = std::fs::File::open(&package_path)?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| crate::Error::from(ErrorKind::OtherError(e.to_string())))?;

        let total_files = archive.len();
        for i in 0..total_files {
            let mut file = archive.by_index(i)
                .map_err(|e| crate::Error::from(ErrorKind::OtherError(e.to_string())))?;
                
            let outpath = match file.enclosed_name() {
                Some(path) => target_dir.join(path),
                None => continue,
            };

            if (*file.name()).ends_with('/') {
                std::fs::create_dir_all(&outpath)?;
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        std::fs::create_dir_all(p)?;
                    }
                }
                let mut outfile = std::fs::File::create(&outpath)?;
                std::io::copy(&mut file, &mut outfile)?;
            }

            if i % 100 == 0 {
                let _ = emit_loading(
                    &loading_bar,
                    100.0 / total_files as f64 * 100.0,
                    Some("Распаковка архива..."),
                );
            }
        }
        
        Ok(())
    }).await.unwrap()
}

async fn extract_msixvc(
    package_path: PathBuf,
    target_dir: PathBuf,
    loading_bar: &LoadingBarId,
) -> crate::Result<()> {
    let loading_bar = loading_bar.clone();
    
    tokio::task::spawn_blocking(move || -> crate::Result<()> {
        let _ = emit_loading(
            &loading_bar,
            10.0,
            Some("Монтирование зашифрованного GDK пакета..."),
        );

        let script = format!(r#"
$ErrorActionPreference = 'Stop'
$PackagePath = "{}"
$TargetDir = "{}"

[Windows.Management.Deployment.PackageManager, Windows.Management.Deployment, ContentType = WindowsRuntime] | Out-Null
$pm = [Windows.Management.Deployment.PackageManager]::new()
$uri = [System.Uri]::new($PackagePath)

# 1. Stage Package
$op = $pm.StagePackageAsync($uri, $null)
while ($op.Status -eq 1) {{ Start-Sleep -Milliseconds 500 }}

if ($op.Status -ne 2 -and $op.Status -ne 0) {{
    Write-Error "Failed to stage package. HRESULT: $((([int]$op.ErrorCode.HResult).ToString('X')))"
    exit 1
}}

# 2. Find Staged Package
$package = $pm.FindPackages() | Where-Object {{ $_.Id.Name -match "MinecraftUWP" }} | Sort-Object -Property {{ $_.Id.Version }} -Descending | Select-Object -First 1
if (-not $package) {{
    Write-Error "MinecraftUWP package not found after staging"
    exit 1
}}

$packageFullName = $package.Id.FullName
$packageFamilyName = $package.Id.FamilyName
$installLoc = $package.InstalledLocation.Path

# 3. Copy files using Invoke-CommandInDesktopPackage to bypass EFS
$scriptBlock = {{
    param($src, $dst)
    Copy-Item -Path "$src\*" -Destination $dst -Recurse -Force
}}

Invoke-CommandInDesktopPackage -AppId "App" -PackageFamilyName $packageFamilyName -Command $scriptBlock -ArgumentList $installLoc, $TargetDir

# 4. Remove Package
$opRemove = $pm.RemovePackageAsync($packageFullName)
while ($opRemove.Status -eq 1) {{ Start-Sleep -Milliseconds 500 }}

# 5. Cleanup self
Remove-Item -Path $PSCommandPath -Force
"#, package_path.to_string_lossy().replace("\"", "`\""), target_dir.to_string_lossy().replace("\"", "`\""));

        #[cfg(target_os = "windows")]
        {
            let temp_ps1 = std::env::temp_dir().join("bedrock_extract.ps1");
            std::fs::write(&temp_ps1, &script)?;

            let run_script = format!(
                "Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{}\"' -Verb RunAs -Wait",
                temp_ps1.to_string_lossy().replace("\"", "`\"")
            );

            let mut cmd = std::process::Command::new("powershell");
            cmd.args(&["-NoProfile", "-NonInteractive", "-Command", &run_script]);
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            
            let status = cmd.status()?;
            if !status.success() {
                return Err(crate::Error::from(ErrorKind::OtherError(
                    "Не удалось расшифровать и скопировать MSIXVC пакет (возможно, отказано в доступе UAC)".to_string()
                )));
            }
        }
        
        let _ = emit_loading(
            &loading_bar,
            90.0,
            Some("Очистка и завершение распаковки..."),
        );

        Ok(())
    }).await.unwrap()
}
