use crate::api::Result;
use theseus::bedrock_worlds::{BedrockWorld, BedrockWorldBackup};

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("bedrock-worlds")
        .invoke_handler(tauri::generate_handler![
            fetch_bedrock_worlds,
            delete_bedrock_world,
            export_bedrock_world,
            import_bedrock_world,
            list_bedrock_world_backups,
            restore_bedrock_world_backup,
            delete_bedrock_world_backup,
            backup_bedrock_world_now,
        ])
        .build()
}

#[tauri::command]
pub async fn fetch_bedrock_worlds(profile_path: String) -> Result<Vec<BedrockWorld>> {
    Ok(theseus::bedrock_worlds::list_bedrock_worlds(&profile_path).await?)
}

#[tauri::command]
pub async fn delete_bedrock_world(profile_path: String, folder_name: String) -> Result<()> {
    Ok(theseus::bedrock_worlds::delete_bedrock_world(&profile_path, &folder_name).await?)
}

#[tauri::command]
pub async fn export_bedrock_world(profile_path: String, folder_name: String, out_path: String) -> Result<()> {
    Ok(theseus::bedrock_worlds::export_bedrock_world(&profile_path, &folder_name, &out_path).await?)
}

#[tauri::command]
pub async fn import_bedrock_world(profile_path: String, archive_path: String) -> Result<()> {
    Ok(theseus::bedrock_worlds::import_bedrock_world(&profile_path, &archive_path).await?)
}

#[tauri::command]
pub async fn list_bedrock_world_backups(profile_path: String) -> Result<Vec<BedrockWorldBackup>> {
    Ok(theseus::bedrock_worlds::list_bedrock_world_backups(&profile_path).await?)
}

#[tauri::command]
pub async fn restore_bedrock_world_backup(
    profile_path: String,
    folder_name: String,
    backup_name: String,
) -> Result<()> {
    Ok(theseus::bedrock_worlds::restore_bedrock_world_backup(&profile_path, &folder_name, &backup_name).await?)
}

#[tauri::command]
pub async fn delete_bedrock_world_backup(
    profile_path: String,
    folder_name: String,
    backup_name: String,
) -> Result<()> {
    Ok(theseus::bedrock_worlds::delete_bedrock_world_backup(&profile_path, &folder_name, &backup_name).await?)
}

#[tauri::command]
pub async fn backup_bedrock_world_now(profile_path: String, folder_name: String) -> Result<()> {
    Ok(theseus::bedrock_worlds::backup_bedrock_world_now(&profile_path, &folder_name).await?)
}
