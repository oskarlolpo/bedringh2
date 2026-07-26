use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::Duration;

const GAME_ID: i32 = 78022;
const CURSEFORGE_API_BASE: &str = "https://api.curseforge.com/v1";
const API_KEY: &str = "$2a$10$3Dr/WLO28GST4n7h7vD0zeWNPjIbwqb1cyVsL66BXAfliCpBC5Ejm";

fn build_http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("x-api-key", reqwest::header::HeaderValue::from_static(API_KEY));
        Client::builder()
            .default_headers(headers)
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap()
    })
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeMod {
    pub id: i32,
    pub name: String,
    pub slug: String,
    pub summary: Option<String>,
    pub download_count: f64,
    pub logo: Option<serde_json::Value>,
    pub categories: Vec<serde_json::Value>,
    pub class_id: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeFile {
    pub id: i32,
    pub display_name: String,
    pub file_name: String,
    pub file_length: u64,
    pub download_url: Option<String>,
    #[serde(default)]
    pub game_versions: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResponse {
    pub data: Vec<CurseForgeMod>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GetModFilesResponse {
    pub data: Vec<CurseForgeFile>,
}

pub async fn search_addons(
    query: &str,
    category_id: Option<i32>,
    class_id: Option<i32>,
    game_version: Option<String>,
) -> crate::Result<Vec<CurseForgeMod>> {
    let client = build_http_client();
    let mut base_url = format!("{}/mods/search?gameId={}&pageSize=50", CURSEFORGE_API_BASE, GAME_ID);
    
    if !query.is_empty() {
        base_url.push_str(&format!("&searchFilter={}", urlencoding::encode(query)));
    }
    if let Some(c) = category_id {
        base_url.push_str(&format!("&categoryId={}", c));
    }
    if let Some(cl) = class_id {
        base_url.push_str(&format!("&classId={}", cl));
    }

    let mut url = base_url.clone();
    if let Some(ref v) = game_version {
        if !v.is_empty() {
            url.push_str(&format!("&gameVersion={}", urlencoding::encode(v)));
        }
    }
    
    if let Ok(resp) = client.get(&url).send().await {
        if let Ok(data) = resp.json::<SearchResponse>().await {
            if !data.data.is_empty() || game_version.is_none() {
                return Ok(data.data);
            }
        }
    }

    // Fallback search without strict gameVersion if strict search returned empty or failed
    let resp = client.get(&base_url).send().await?.json::<SearchResponse>().await?;
    Ok(resp.data)
}

pub async fn get_addon_files(mod_id: i32) -> crate::Result<Vec<CurseForgeFile>> {
    let client = build_http_client();
    let url = format!("{}/mods/{}/files?pageSize=50", CURSEFORGE_API_BASE, mod_id);
    let resp = client.get(&url).send().await?.json::<GetModFilesResponse>().await?;
    Ok(resp.data)
}

pub async fn download_addon(url: &str) -> crate::Result<String> {
    let client = build_http_client();
    let resp = client.get(url).send().await?;
    let bytes = resp.bytes().await?;
    
    let temp_dir = std::env::temp_dir().join("bedringh");
    tokio::fs::create_dir_all(&temp_dir).await?;
    let file_path = temp_dir.join(format!("{}.mcpack", uuid::Uuid::new_v4()));
    
    tokio::fs::write(&file_path, bytes).await?;
    Ok(file_path.to_string_lossy().to_string())
}

