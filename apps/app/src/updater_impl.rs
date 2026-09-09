use crate::api::Result;
use futures::StreamExt;
use std::sync::Mutex;
use tauri::{Manager, Resource, ResourceId, Runtime, Webview};
use tauri_plugin_http::reqwest;
use theseus::{emit_loading, init_loading, launcher_user_agent, LoadingBarType, State};
use tokio::io::AsyncWriteExt;

const GITHUB_REPO: &str = "oskarlolpo/bedringh2";

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct GitHubReleaseAsset {
    pub name: String,
    pub size: u64,
    pub browser_download_url: String,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct GitHubRelease {
    pub tag_name: String,
    pub name: Option<String>,
    pub body: Option<String>,
    pub published_at: Option<String>,
    #[serde(default)]
    pub assets: Vec<GitHubReleaseAsset>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct BedringhUpdate {
    pub current_version: String,
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
    pub download_url: String,
    pub size: Option<u64>,
}

impl Resource for BedringhUpdate {}

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub rid: ResourceId,
    pub current_version: String,
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
    pub raw_json: serde_json::Value,
}

#[derive(Clone, Debug)]
pub struct PendingUpdate {
    pub version: String,
    pub installer_path: std::path::PathBuf,
}

#[derive(Default)]
pub struct PendingUpdateData(pub Mutex<Option<PendingUpdate>>);

fn parse_version_tuple(v: &str) -> (Vec<u64>, String) {
    let clean = v.trim().trim_start_matches('v');
    let mut parts = clean.splitn(2, '-');
    let numbers = parts.next().unwrap_or("");
    let prerelease = parts.next().unwrap_or("").to_string();

    let nums: Vec<u64> = numbers
        .split('.')
        .filter_map(|s| s.parse::<u64>().ok())
        .collect();

    (nums, prerelease)
}

fn is_version_newer(remote: &str, current: &str) -> bool {
    let (remote_nums, remote_pre) = parse_version_tuple(remote);
    let (current_nums, current_pre) = parse_version_tuple(current);

    let max_len = remote_nums.len().max(current_nums.len());
    for i in 0..max_len {
        let r = remote_nums.get(i).copied().unwrap_or(0);
        let c = current_nums.get(i).copied().unwrap_or(0);
        if r > c {
            return true;
        } else if r < c {
            return false;
        }
    }

    if current_pre.is_empty() && !remote_pre.is_empty() {
        return false;
    }
    if !current_pre.is_empty() && remote_pre.is_empty() {
        return true;
    }

    remote_pre > current_pre
}

async fn fetch_latest_github_release() -> Result<GitHubRelease> {
    let client = reqwest::Client::builder()
        .user_agent(launcher_user_agent())
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let api_url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");
    tracing::info!("Checking for Bedringh updates at {}", api_url);

    let res = client
        .get(&api_url)
        .header(reqwest::header::ACCEPT, "application/vnd.github.v3+json")
        .send()
        .await;

    match res {
        Ok(response) if response.status().is_success() => {
            let release: GitHubRelease = response.json().await?;
            tracing::info!(
                "Fetched latest release from GitHub: tag={}, name={:?}",
                release.tag_name,
                release.name
            );
            return Ok(release);
        }
        Ok(response) => {
            tracing::warn!(
                "GitHub API returned HTTP {}: falling back to web redirect check",
                response.status()
            );
        }
        Err(err) => {
            tracing::warn!(
                "Failed to call GitHub API ({err}): falling back to web redirect check"
            );
        }
    }

    // Fallback: check redirect of https://github.com/{GITHUB_REPO}/releases/latest
    let redirect_client = reqwest::Client::builder()
        .user_agent(launcher_user_agent())
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let web_url = format!("https://github.com/{GITHUB_REPO}/releases/latest");
    let resp = redirect_client.get(&web_url).send().await?;
    if let Some(loc) = resp.headers().get(reqwest::header::LOCATION) {
        let loc_str = loc.to_str().unwrap_or_default();
        if let Some(tag) = loc_str.split("/releases/tag/").nth(1) {
            let tag = tag.trim().to_string();
            let clean_ver = tag.trim_start_matches('v');
            let asset_name = format!("Bedringh_{clean_ver}_x64-setup.exe");
            let download_url = format!(
                "https://github.com/{GITHUB_REPO}/releases/download/{tag}/{asset_name}"
            );
            return Ok(GitHubRelease {
                tag_name: tag.clone(),
                name: Some(format!("Bedringh {clean_ver}")),
                body: None,
                published_at: None,
                assets: vec![GitHubReleaseAsset {
                    name: asset_name,
                    size: 0,
                    browser_download_url: download_url,
                }],
            });
        }
    }

    Err(theseus::Error::from(theseus::ErrorKind::OtherError(
        "Failed to fetch latest release from GitHub".to_string(),
    ))
    .into())
}

#[tauri::command]
pub async fn check<R: Runtime>(
    webview: Webview<R>,
    _headers: Option<Vec<(String, String)>>,
    _timeout: Option<u64>,
    _proxy: Option<String>,
    _target: Option<String>,
    allow_downgrades: Option<bool>,
) -> Result<Option<Metadata>> {
    let release = match fetch_latest_github_release().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("Update check failed: {e}");
            return Ok(None);
        }
    };

    let current_version = webview.app_handle().package_info().version.to_string();
    let remote_version = release.tag_name.trim_start_matches('v').to_string();

    let force_update = std::env::var("BEDRINGH_FORCE_UPDATE").is_ok();
    let is_newer = is_version_newer(&remote_version, &current_version);
    let should_update = is_newer
        || force_update
        || (allow_downgrades.unwrap_or(false) && remote_version != current_version);

    if !should_update {
        tracing::info!(
            "No updates available: current={}, latest={}",
            current_version,
            remote_version
        );
        return Ok(None);
    }

    // Find suitable Windows asset (.exe)
    let asset = release
        .assets
        .iter()
        .find(|a| {
            let lower = a.name.to_lowercase();
            lower.ends_with(".exe")
                && (lower.contains("setup") || lower.contains("bedringh") || lower.contains("x64"))
        })
        .or_else(|| {
            release
                .assets
                .iter()
                .find(|a| a.name.to_lowercase().ends_with(".exe"))
        });

    let (download_url, size) = if let Some(a) = asset {
        (
            a.browser_download_url.clone(),
            if a.size > 0 { Some(a.size) } else { None },
        )
    } else {
        (
            format!(
                "https://github.com/{GITHUB_REPO}/releases/download/{}/Bedringh_{}_x64-setup.exe",
                release.tag_name, remote_version
            ),
            None,
        )
    };

    tracing::info!(
        "Found Bedringh update: version {} (current {}), url: {}",
        remote_version,
        current_version,
        download_url
    );

    let raw_json = serde_json::to_value(&release).unwrap_or_default();
    let update = BedringhUpdate {
        current_version: current_version.clone(),
        version: remote_version.clone(),
        date: release.published_at.clone(),
        body: release.body.clone(),
        download_url,
        size,
    };

    let rid = webview.resources_table().add(update);
    let metadata = Metadata {
        rid,
        current_version,
        version: remote_version,
        date: release.published_at,
        body: release.body,
        raw_json,
    };

    Ok(Some(metadata))
}

#[tauri::command]
pub async fn get_update_size<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
) -> Result<Option<u64>> {
    let update = webview.resources_table().get::<BedringhUpdate>(rid)?;
    if let Some(size) = update.size {
        if size > 0 {
            return Ok(Some(size));
        }
    }

    let client = reqwest::Client::builder()
        .user_agent(launcher_user_agent())
        .build()?;
    let res = client.head(&update.download_url).send().await?;
    let content_length = res
        .headers()
        .get("Content-Length")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok());

    Ok(content_length)
}

#[tauri::command]
pub async fn enqueue_update_for_installation<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
) -> Result<()> {
    let pending_data = webview.state::<PendingUpdateData>().inner();
    let update = webview.resources_table().get::<BedringhUpdate>(rid)?;

    let progress = init_loading(
        LoadingBarType::LauncherUpdate {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
        },
        1.0,
        "Downloading update...",
    )
    .await?;

    let state = State::get().await?;
    let updates_dir = state.directories.caches_dir().join("updates");
    tokio::fs::create_dir_all(&updates_dir).await?;
    let installer_path = updates_dir.join(format!("Bedringh_{}_setup.exe", update.version));

    let client = reqwest::Client::builder()
        .user_agent(launcher_user_agent())
        .build()?;

    let response = client.get(&update.download_url).send().await?;
    if !response.status().is_success() {
        return Err(theseus::Error::from(theseus::ErrorKind::OtherError(format!(
            "Failed to download update from {}: HTTP {}",
            update.download_url,
            response.status()
        )))
        .into());
    }

    let total_size = response.content_length().or(update.size);

    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&installer_path).await?;
    let mut downloaded: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            theseus::Error::from(theseus::ErrorKind::OtherError(format!(
                "Error downloading update chunk: {e}"
            )))
        })?;
        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;

        if let Some(total) = total_size {
            if total > 0 {
                let fraction = (downloaded as f64 / total as f64).min(1.0);
                let _ = emit_loading(&progress, fraction, None);
            }
        }
    }
    file.flush().await?;
    let _ = emit_loading(&progress, 1.0, None);

    tracing::info!("Update downloaded successfully to {:?}", installer_path);

    pending_data.0.lock().unwrap().replace(PendingUpdate {
        version: update.version.clone(),
        installer_path,
    });

    Ok(())
}

#[tauri::command]
pub fn remove_enqueued_update<R: Runtime>(webview: Webview<R>) {
    let pending_data = webview.state::<PendingUpdateData>().inner();
    pending_data.0.lock().unwrap().take();
}

pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("updater")
        .invoke_handler(tauri::generate_handler![
            check,
            get_update_size,
            enqueue_update_for_installation,
            remove_enqueued_update,
        ])
        .build()
}
