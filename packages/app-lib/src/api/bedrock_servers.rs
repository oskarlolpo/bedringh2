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

pub async fn list_favorite_servers() -> Result<Vec<FavoriteServer>> {
    let path = get_servers_path().await?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = fs::read_to_string(path).await?;
    let servers: Vec<FavoriteServer> = serde_json::from_str(&data).unwrap_or_else(|_| Vec::new());
    Ok(servers)
}

pub async fn add_favorite_server(server: FavoriteServer) -> Result<()> {
    let mut servers = list_favorite_servers().await?;
    servers.push(server);
    let path = get_servers_path().await?;
    let data = serde_json::to_string_pretty(&servers).unwrap();
    fs::write(path, data).await?;
    Ok(())
}

pub async fn remove_favorite_server(id: String) -> Result<()> {
    let mut servers = list_favorite_servers().await?;
    servers.retain(|s| s.id != id);
    let path = get_servers_path().await?;
    let data = serde_json::to_string_pretty(&servers).unwrap();
    fs::write(path, data).await?;
    Ok(())
}

