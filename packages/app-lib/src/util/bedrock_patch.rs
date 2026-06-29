
use crate::event::emit::{edit_loading, emit_loading};
use crate::event::{LoadingBarId, LoadingBarType};
use std::path::Path;

pub async fn patch_manifest(
    versions_dir: &Path,
    loading_bar: &LoadingBarId,
    profile_name: &str,
    profile_path: &str,
) -> crate::Result<()> {
    let manifest_path = versions_dir.join("AppxManifest.xml");
    if !manifest_path.exists() {
        tracing::warn!("AppxManifest.xml не найден в папке с версией. Пропускаем патчинг манифеста.");
        return Ok(());
    }

    let _ = edit_loading(
        loading_bar,
        LoadingBarType::MinecraftDownload {
            profile_name: profile_name.to_string(),
            profile_path: profile_path.to_string(),
        },
        100.0,
        "Патчинг манифеста...",
    )
    .await;

    // 1. Патчинг AppxManifest.xml
    let mut content = tokio::fs::read_to_string(&manifest_path).await?;

    // Удаляем capability customInstallActions (вызывает ошибки при установке распакованного приложения)
    let re_custom_install_cap = regex::Regex::new(
        r#"(?s)<[^>]*Capability[^>]*Name="customInstallActions"[^>]*>"#,
    )
    .unwrap();
    content = re_custom_install_cap.replace_all(&content, "").to_string();

    // Удаляем extension windows.customInstall, так как мы удалили capability
    let re_custom_install_ext = regex::Regex::new(r#"(?s)<[^>]*Extension[^>]*Category="windows\.customInstall"[^>]*>.*?</[^>]*Extension>"#).unwrap();
    content = re_custom_install_ext.replace_all(&content, "").to_string();

    // Мы НЕ меняем Identity Name, так как это ломает Xbox Live (gamingservicesui.exe crash).
    // Оригинальный Identity Name (Microsoft.MinecraftUWP) необходим для работы интеграции со Store и Xbox.
    tokio::fs::write(&manifest_path, content).await?;

    let _ = emit_loading(loading_bar, 100.0, Some("Готово!"));

    Ok(())
}

pub async fn create_instance_skeleton(profile_path: &str) -> crate::Result<()> {
    let instance_path =
        crate::api::profile::get_full_path(profile_path).await?;

    let base_dir = instance_path.join("com.mojang");
    tokio::fs::create_dir_all(&base_dir).await?;
    tokio::fs::create_dir_all(base_dir.join("minecraftWorlds")).await?;
    tokio::fs::create_dir_all(base_dir.join("resource_packs")).await?;
    tokio::fs::create_dir_all(base_dir.join("behavior_packs")).await?;
    tokio::fs::create_dir_all(base_dir.join("minecraftpe")).await?;

    Ok(())
}
