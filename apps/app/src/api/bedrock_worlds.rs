use crate::api::Result;
use theseus::bedrock_worlds::BedrockWorld;

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("bedrock-worlds")
        .invoke_handler(tauri::generate_handler![
            fetch_bedrock_worlds,
            delete_bedrock_world,
            export_bedrock_world,
            import_bedrock_world,
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
