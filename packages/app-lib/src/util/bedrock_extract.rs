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
    if target_dir.join("AppxManifest.xml").exists() {
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

$existing = Get-AppxPackage -Name "Microsoft.MinecraftUWP"
$restorePaths = @()
if ($existing) {{
    foreach ($pkg in $existing) {{
        $restorePaths += $pkg.InstallLocation
        Remove-AppxPackage -Package $pkg.PackageFullName
    }}
}}

try {{
    Add-AppxPackage -Path $PackagePath -Stage
    $pkg = Get-AppxPackage -AllUsers -Name "Microsoft.MinecraftUWP" | Sort-Object -Property Version -Descending | Select-Object -First 1
    
    if (-not $pkg) {{
        throw "Staged package not found."
    }}

    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
    robocopy $pkg.InstallLocation $TargetDir /E /ZB /COPYALL /R:1 /W:1
    
    Remove-AppxPackage -AllUsers -Package $pkg.PackageFullName
}} finally {{
    foreach ($path in $restorePaths) {{
        if (Test-Path "$path\AppxManifest.xml") {{
            Add-AppxPackage -Register "$path\AppxManifest.xml"
        }}
    }}
    Remove-Item -Path $PSCommandPath -Force
}}
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
