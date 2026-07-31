#![cfg(windows)]

use crate::event::LoadingBarId;
use crate::event::emit::emit_loading;
use crate::ErrorKind;
use std::os::windows::process::CommandExt;
use std::process::Command;
use tracing::warn;
use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY};
use winreg::RegKey;

/// Check if Windows Developer Mode is enabled.
pub fn is_developer_mode_enabled() -> bool {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(key) = hklm.open_subkey_with_flags(
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock",
        KEY_READ | KEY_WOW64_64KEY,
    ) {
        if let Ok(val) = key.get_value::<u32, _>("AllowDevelopmentWithoutDevLicense") {
            return val == 1;
        }
    }
    false
}

pub fn auto_enable_developer_mode() -> crate::Result<()> {
    let install_output = Command::new("powershell")
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .args(&[
            "-NoProfile",
            "-Command",
            "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -Command New-ItemProperty -Path \"HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock\" -Name \"AllowDevelopmentWithoutDevLicense\" -Value 1 -PropertyType DWORD -Force'"
        ])
        .output();
        
    if let Ok(out) = install_output {
        if !out.status.success() {
            warn!("Failed to auto-enable Developer Mode: {}", String::from_utf8_lossy(&out.stderr));
        }
    }
    
    // Give it a tiny bit of time to apply in registry
    std::thread::sleep(std::time::Duration::from_millis(500));
    Ok(())
}

pub fn check_developer_mode() -> crate::Result<()> {
    if !is_developer_mode_enabled() {
        auto_enable_developer_mode()?;
        if !is_developer_mode_enabled() {
            return Err(ErrorKind::LauncherError(
                "Windows Developer Mode is required for UWP apps. Auto-enabling failed. Please enable it manually in ms-settings:developers and try again.".into(),
            ).into());
        }
    }
    Ok(())
}

fn uwp_deps_list() -> &'static [(&'static str, &'static str)] {
    &[
        ("Microsoft.VCLibs.140.00", "https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx"),
        ("Microsoft.VCLibs.140.00.UWPDesktop", ""),
        ("Microsoft.NET.Native.Runtime.1.4", ""),
        ("Microsoft.NET.Native.Runtime.2.2", ""),
        ("Microsoft.NET.Native.Framework.1.3", ""),
        ("Microsoft.NET.Native.Framework.2.2", ""),
        ("Microsoft.Services.Store.Engagement", ""),
        ("Microsoft.GamingServices", ""),
    ]
}

pub async fn check_and_install_vclibs(loading_bar: &LoadingBarId) -> crate::Result<()> {
    // Only VCLibs has a reliable direct download link.
    // For others, if they are missing, we log it. We may use store.rg-adguard.net for others,
    // but a basic `Get-AppxPackage` check helps verify if installation is needed.
    
    let output = tokio::task::spawn_blocking(|| {
        Command::new("powershell")
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .args(&[
                "-NoProfile",
                "-Command",
                "Get-AppxPackage -Name '*Microsoft.VCLibs.140.00*'",
            ])
            .output()
    })
    .await;

    if let Ok(Ok(out)) = output {
        let stdout = String::from_utf8_lossy(&out.stdout);
        if stdout.contains("Microsoft.VCLibs") {
            return Ok(()); // already installed
        }
    }

    let _ = emit_loading(loading_bar, 0.0, Some("Установка VCLibs..."));
    
    // Install via Add-AppxPackage directly
    let install_output = tokio::task::spawn_blocking(|| {
        Command::new("powershell")
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .args(&[
                "-NoProfile",
                "-Command",
                "Add-AppxPackage -Path https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx",
            ])
            .output()
    }).await;

    if let Ok(Ok(out)) = install_output {
        if !out.status.success() {
            warn!("Warning: Failed to auto-install VCLibs: {}", String::from_utf8_lossy(&out.stderr));
        }
    }

    Ok(())
}

pub fn is_game_input_installed() -> bool {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let paths = [
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];

    for path in paths {
        if let Ok(root_key) = hklm.open_subkey_with_flags(path, KEY_READ | KEY_WOW64_64KEY) {
            for key_name in root_key.enum_keys().flatten() {
                if let Ok(entry) = root_key.open_subkey_with_flags(&key_name, KEY_READ | KEY_WOW64_64KEY) {
                    let display_name: String = entry.get_value("DisplayName").unwrap_or_default();
                    let publisher: String = entry.get_value("Publisher").unwrap_or_default();
                    let name_lower = display_name.to_ascii_lowercase();
                    let pub_lower = publisher.to_ascii_lowercase();

                    if name_lower.contains("gameinput") && (pub_lower.contains("microsoft") || name_lower.contains("microsoft")) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

pub async fn check_and_install_gameinput(loading_bar: &LoadingBarId) -> crate::Result<()> {
    if is_game_input_installed() {
        return Ok(());
    }

    let _ = emit_loading(loading_bar, 0.0, Some("Скачивание GameInput Runtime..."));

    // Download MSI
    let temp_dir = std::env::temp_dir();
    let msi_path = temp_dir.join("GameInputRedist.msi");
    
    let client = reqwest::Client::new();
    let res = client.get("https://github.com/microsoftconnect/GameInput/releases/latest/download/GameInputRedist.msi")
        .send().await
        .map_err(|e| ErrorKind::LauncherError(format!("Failed to download GameInput: {}", e)))?;
        
    if !res.status().is_success() {
        return Err(ErrorKind::LauncherError("GameInput download returned non-success".into()).into());
    }

    let bytes = res.bytes().await
        .map_err(|e| ErrorKind::LauncherError(format!("Failed to read GameInput response: {}", e)))?;
        
    tokio::fs::write(&msi_path, bytes).await?;

    let _ = emit_loading(loading_bar, 0.0, Some("Установка GameInput Runtime... (разрешите UAC)"));

    // Execute MSI with explicit elevation. msiexec does NOT auto-elevate just
    // because it's msiexec - when spawned as a direct child process (as opposed
    // to via the shell/explorer), it inherits our own process token. If Bedrin
    // itself isn't running elevated, msiexec silently fails to write to
    // protected locations (C:\Windows\Installer, Program Files, HKLM) with
    // exactly Windows Installer errors 2502/2503. Route through
    // `Start-Process -Verb RunAs` (the same elevation pattern already used by
    // auto_enable_developer_mode above) so the user gets a real UAC prompt and
    // the install actually has the rights it needs.
    let msi_path_str = msi_path.to_string_lossy().to_string();
    let ps_command = format!(
        "$p = Start-Process msiexec -ArgumentList '/i \"{}\" /qb /norestart' -Verb RunAs -Wait -PassThru; exit $p.ExitCode",
        msi_path_str.replace('\'', "''")
    );
    let msi_install_output = tokio::task::spawn_blocking(move || {
        Command::new("powershell")
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .args(&["-NoProfile", "-Command", &ps_command])
            .output()
    }).await;

    match msi_install_output {
        Ok(Ok(out)) if out.status.success() => Ok(()),
        Ok(Ok(out)) => {
            warn!("GameInput install failed. Code: {}, STDERR: {}", out.status, String::from_utf8_lossy(&out.stderr));
            Err(ErrorKind::LauncherError(format!(
                "Отказ при установке GameInput Runtime (код {}). Либо UAC-запрос был отклонён, либо установщику не хватило прав даже с повышением - попробуйте установить GameInputRedist.msi вручную от имени администратора.",
                out.status
            )).into())
        }
        Ok(Err(e)) => Err(ErrorKind::LauncherError(format!(
            "Не удалось запустить установщик GameInput Runtime: {e}"
        )).into()),
        Err(e) => Err(ErrorKind::LauncherError(format!(
            "Внутренняя ошибка при установке GameInput Runtime: {e}"
        )).into()),
    }
}

pub async fn download_fallback_dll(filename: &str, target_path: &std::path::Path) -> crate::Result<()> {
    if target_path.exists() {
        return Ok(());
    }
    let client = reqwest::Client::builder()
        .user_agent("BedringhLauncher")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let urls = [
        format!("https://github.com/oskarlolpo/bedrock-repacker/releases/download/unlocker-dlls/{}", filename),
        format!("https://github.com/oskarlolpo/unlocker-dlls/releases/latest/download/{}", filename),
        format!("https://raw.githubusercontent.com/oskarlolpo/unlocker-dlls/main/{}", filename),
        format!("https://github.com/oskarlolpo/bedrock-repacker/releases/latest/download/{}", filename),
        format!("https://raw.githubusercontent.com/oskarlolpo/bedrock-repacker/main/{}", filename),
    ];

    for url in &urls {
        if let Ok(res) = client.get(url).send().await {
            if res.status().is_success() {
                if let Ok(bytes) = res.bytes().await {
                    if let Some(parent) = target_path.parent() {
                        let _ = tokio::fs::create_dir_all(parent).await;
                    }
                    if tokio::fs::write(target_path, bytes).await.is_ok() {
                        return Ok(());
                    }
                }
            }
        }
    }

    Err(ErrorKind::LauncherError(format!("Failed to download missing runtime library: {}", filename)).into())
}
