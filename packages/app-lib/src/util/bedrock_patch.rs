use crate::event::emit::{emit_loading, edit_loading};
use crate::event::{LoadingBarId, LoadingBarType};
use crate::ErrorKind;
use std::path::{Path, PathBuf};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

pub async fn patch_and_register(
    versions_dir: &Path,
    loading_bar: &LoadingBarId,
    profile_name: &str,
    profile_path: &str,
) -> crate::Result<()> {
    let manifest_path = versions_dir.join("AppxManifest.xml");
    if !manifest_path.exists() {
        return Err(crate::Error::from(ErrorKind::OtherError(
            "AppxManifest.xml не найден в папке с версией".to_string()
        )));
    }

    let _ = edit_loading(
        loading_bar,
        LoadingBarType::MinecraftDownload {
            profile_name: profile_name.to_string(),
            profile_path: profile_path.to_string(),
        },
        100.0,
        "Патчинг манифеста...",
    ).await;

    // 1. Патчинг AppxManifest.xml
    let mut content = tokio::fs::read_to_string(&manifest_path).await?;
    
    // Удаляем блок <Extensions> ... </Extensions>
    let re_extensions = regex::Regex::new(r"(?s)<Extensions.*?>.*?</Extensions>").unwrap();
    content = re_extensions.replace_all(&content, "").to_string();

    // Удаляем capability customInstallActions
    let re_custom_install = regex::Regex::new(r#"(?s)<[^>]*Capability[^>]*Name="customInstallActions"[^>]*>"#).unwrap();
    content = re_custom_install.replace_all(&content, "").to_string();

    tokio::fs::write(&manifest_path, content).await?;

    let _ = emit_loading(
        loading_bar,
        50.0,
        Some("Регистрация версии в системе..."),
    );

    // 2. Регистрация в Development Mode
    tokio::task::spawn_blocking({
        let manifest_path = manifest_path.clone();
        move || -> crate::Result<()> {
            #[cfg(target_os = "windows")]
            {
                let script = format!(
                    "Add-AppxPackage -Register \"{}\"",
                    manifest_path.to_string_lossy().replace("\"", "`\"")
                );

                let mut cmd = std::process::Command::new("powershell");
                cmd.args(&["-NoProfile", "-NonInteractive", "-Command", &script]);
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                
                let status = cmd.status()?;
                if !status.success() {
                    return Err(crate::Error::from(ErrorKind::OtherError(
                        "Не удалось зарегистрировать Appx пакет в режиме разработчика".to_string()
                    )));
                }
            }
            Ok(())
        }
    }).await.unwrap()?;

    Ok(())
}

pub async fn create_instance_skeleton(profile_path: &str) -> crate::Result<()> {
    let instance_path = crate::api::profile::get_full_path(profile_path).await?;
    
    let base_dir = instance_path.join("com.mojang");
    tokio::fs::create_dir_all(&base_dir).await?;
    tokio::fs::create_dir_all(base_dir.join("minecraftWorlds")).await?;
    tokio::fs::create_dir_all(base_dir.join("resource_packs")).await?;
    tokio::fs::create_dir_all(base_dir.join("behavior_packs")).await?;
    tokio::fs::create_dir_all(base_dir.join("minecraftpe")).await?;
    
    Ok(())
}
