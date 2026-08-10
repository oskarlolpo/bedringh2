use crate::api::Result;
use theseus::bedrock_servers::FavoriteServer;

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("bedrock-servers")
        .invoke_handler(tauri::generate_handler![
            list_favorite_servers,
            add_favorite_server,
            remove_favorite_server
        ])
        .build()
}

#[tauri::command]
pub async fn list_favorite_servers() -> Result<Vec<FavoriteServer>> {
    Ok(theseus::bedrock_servers::list_favorite_servers().await?)
}

#[tauri::command]
pub async fn add_favorite_server(server: FavoriteServer) -> Result<()> {
    Ok(theseus::bedrock_servers::add_favorite_server(server).await?)
}

#[tauri::command]
pub async fn remove_favorite_server(id: String) -> Result<()> {
    Ok(theseus::bedrock_servers::remove_favorite_server(id).await?)
}
