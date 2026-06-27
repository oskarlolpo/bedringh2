use crate::api::Result;
use theseus::bedrock::BedrockVersion;

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("bedrock")
        .invoke_handler(tauri::generate_handler![
            fetch_bedrock_versions,
        ])
        .build()
}

#[tauri::command]
pub async fn fetch_bedrock_versions() -> Result<Vec<BedrockVersion>> {
    Ok(theseus::bedrock::fetch_bedrock_versions().await?)
}
