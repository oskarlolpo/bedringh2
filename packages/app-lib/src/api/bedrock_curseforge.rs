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
pub struct CurseForgeAuthor {
    pub id: i32,
    pub name: String,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeMod {
    pub id: i32,
    pub game_id: Option<i32>,
    pub name: String,
    pub slug: String,
    pub summary: Option<String>,
    pub download_count: f64,
    pub logo: Option<serde_json::Value>,
    pub categories: Vec<serde_json::Value>,
    pub class_id: Option<i32>,
    #[serde(default)]
    pub authors: Vec<CurseForgeAuthor>,
    pub website_url: Option<String>,
    #[serde(default)]
    pub latest_files: Vec<CurseForgeFile>,
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
#[serde(rename_all = "camelCase")]
pub struct CurseForgePagination {
    pub index: i32,
    pub page_size: i32,
    pub result_count: i32,
    pub total_count: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResponse {
    pub data: Vec<CurseForgeMod>,
    pub pagination: Option<CurseForgePagination>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeSearchResult {
    pub data: Vec<CurseForgeMod>,
    pub total_count: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GetModResponse {
    pub data: CurseForgeMod,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GetDescriptionResponse {
    pub data: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GetModFilesResponse {
    pub data: Vec<CurseForgeFile>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeMinecraftVersion {
    pub id: i32,
    pub game_version_id: Option<i32>,
    pub version_string: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GetMinecraftVersionsResponse {
    pub data: Vec<CurseForgeMinecraftVersion>,
}

pub async fn get_curseforge_minecraft_versions() -> crate::Result<Vec<String>> {
    let client = build_http_client();
    let url = format!("{}/minecraft/version", CURSEFORGE_API_BASE);
    let resp = client.get(&url).send().await?.json::<GetMinecraftVersionsResponse>().await?;
    let versions = resp.data.into_iter().map(|v| v.version_string).collect();
    Ok(versions)
}

pub async fn search_addons(
    query: &str,
    category_id: Option<i32>,
    class_id: Option<i32>,
    game_version: Option<String>,
    sort_field: Option<i32>,
    sort_order: Option<String>,
    index: Option<i32>,
    page_size: Option<i32>,
) -> crate::Result<CurseForgeSearchResult> {
    let client = build_http_client();
    let idx = index.unwrap_or(0);
    let ps = page_size.unwrap_or(20);

    let mut base_url = format!(
        "{}/mods/search?gameId={}&index={}&pageSize={}",
        CURSEFORGE_API_BASE, GAME_ID, idx, ps
    );
    
    if !query.is_empty() {
        base_url.push_str(&format!("&searchFilter={}", urlencoding::encode(query)));
    }
    if let Some(c) = category_id {
        base_url.push_str(&format!("&categoryId={}", c));
    }
    if let Some(cl) = class_id {
        base_url.push_str(&format!("&classId={}", cl));
    }
    if let Some(sf) = sort_field {
        base_url.push_str(&format!("&sortField={}", sf));
    }
    if let Some(ref so) = sort_order {
        if !so.is_empty() {
            base_url.push_str(&format!("&sortOrder={}", urlencoding::encode(so)));
        }
    }

    let mut url = base_url.clone();
    if let Some(ref v) = game_version {
        if !v.is_empty() {
            url.push_str(&format!("&gameVersion={}", urlencoding::encode(v)));
        }
    }
    
    if let Ok(resp) = client.get(&url).send().await {
        if let Ok(data) = resp.json::<SearchResponse>().await {
            let total = data.pagination.as_ref().map(|p| p.total_count).unwrap_or(data.data.len() as i32);
            if !data.data.is_empty() || game_version.is_none() {
                return Ok(CurseForgeSearchResult {
                    data: data.data,
                    total_count: total,
                });
            }
        }
    }

    // Fallback search without strict gameVersion if strict search returned empty or failed
    let resp = client.get(&base_url).send().await?.json::<SearchResponse>().await?;
    let total = resp.pagination.as_ref().map(|p| p.total_count).unwrap_or(resp.data.len() as i32);
    Ok(CurseForgeSearchResult {
        data: resp.data,
        total_count: total,
    })
}

pub async fn get_addon_details(mod_id: i32) -> crate::Result<CurseForgeMod> {
    let client = build_http_client();
    let url = format!("{}/mods/{}", CURSEFORGE_API_BASE, mod_id);
    let resp = client.get(&url).send().await?.json::<GetModResponse>().await?;
    Ok(resp.data)
}

pub async fn get_addon_description(mod_id: i32) -> crate::Result<String> {
    let client = build_http_client();
    let url = format!("{}/mods/{}/description", CURSEFORGE_API_BASE, mod_id);
    let resp = client.get(&url).send().await?.json::<GetDescriptionResponse>().await?;
    Ok(resp.data)
}

pub async fn get_addon_files(mod_id: i32) -> crate::Result<Vec<CurseForgeFile>> {
    let client = build_http_client();
    let url = format!("{}/mods/{}/files?pageSize=50", CURSEFORGE_API_BASE, mod_id);
    let resp = client.get(&url).send().await?.json::<GetModFilesResponse>().await?;
    Ok(resp.data)
}

fn build_download_client() -> &'static Client {
    static DOWNLOAD_CLIENT: OnceLock<Client> = OnceLock::new();
    DOWNLOAD_CLIENT.get_or_init(|| {
        // Deliberately NOT reusing build_http_client() here: that client attaches
        // an `x-api-key` header meant for api.curseforge.com. edge.forgecdn.net is a
        // separate CDN host that doesn't expect that header, and sending it can
        // cause the CDN/WAF to reject the request or return a non-file response,
        // which then fails further down as a confusing "error decoding response body".
        Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .unwrap()
    })
}

pub async fn download_addon(url: &str) -> crate::Result<String> {
    let client = build_download_client();
    let resp = client.get(url).send().await.map_err(|e| {
        crate::ErrorKind::OtherError(format!(
            "Failed to reach CurseForge CDN for download: {e}. The file host (edge.forgecdn.net) may be temporarily unavailable, or this download requires opening the mod's CurseForge page directly."
        ))
    })?;

    let status = resp.status();
    if !status.is_success() {
        return Err(crate::ErrorKind::OtherError(format!(
            "CurseForge CDN returned an error status ({status}) while downloading the file. \
             This can happen if the file was removed, or if the mod author has disabled third-party/direct downloads for this file."
        ))
        .into());
    }

    let bytes = resp.bytes().await.map_err(|e| {
        crate::ErrorKind::OtherError(format!(
            "Failed to read the downloaded file's contents: {e}. The download may have been interrupted or the CDN returned an incomplete response."
        ))
    })?;

    if bytes.is_empty() {
        return Err(crate::ErrorKind::OtherError(
            "CurseForge CDN returned an empty file body.".to_string(),
        )
        .into());
    }

    let temp_dir = std::env::temp_dir().join("bedringh");
    tokio::fs::create_dir_all(&temp_dir).await?;
    let file_path = temp_dir.join(format!("{}.mcpack", uuid::Uuid::new_v4()));

    tokio::fs::write(&file_path, bytes).await?;
    Ok(file_path.to_string_lossy().to_string())
}

