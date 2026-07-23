use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use crate::error::Result;
use crate::State;
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteServer {
    pub id: String,
    pub name: String,
    pub address: String,
    pub port: u16,
    pub instance_id: Option<String>,
}

pub async fn get_servers_path() -> Result<PathBuf> {
    let state = State::get().await?;
    let config_dir = state.directories.config_dir.clone();
    let servers_path = config_dir.join("bedrock_favorite_servers.json");
    Ok(servers_path)
}

#[tauri::command]
pub async fn list_favorite_servers() -> std::result::Result<Vec<FavoriteServer>, String> {
    let path = get_servers_path().await.map_err(|e| e.to_string())?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = fs::read_to_string(path).await.map_err(|e| e.to_string())?;
    let servers: Vec<FavoriteServer> = serde_json::from_str(&data).unwrap_or_else(|_| Vec::new());
    Ok(servers)
}

#[tauri::command]
pub async fn add_favorite_server(server: FavoriteServer) -> std::result::Result<(), String> {
    let mut servers = list_favorite_servers().await?;
    servers.push(server);
    let path = get_servers_path().await.map_err(|e| e.to_string())?;
    let data = serde_json::to_string_pretty(&servers).unwrap();
    fs::write(path, data).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn remove_favorite_server(id: String) -> std::result::Result<(), String> {
    let mut servers = list_favorite_servers().await?;
    servers.retain(|s| s.id != id);
    let path = get_servers_path().await.map_err(|e| e.to_string())?;
    let data = serde_json::to_string_pretty(&servers).unwrap();
    fs::write(path, data).await.map_err(|e| e.to_string())?;
    Ok(())
}

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("bedrock-servers")
        .invoke_handler(tauri::generate_handler![
            list_favorite_servers,
            add_favorite_server,
            remove_favorite_server
        ])
        .build()
}
