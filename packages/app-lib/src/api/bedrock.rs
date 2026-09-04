use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BedrockVersion {
    pub version: String,
    pub is_preview: bool,
    pub identifier: String,
    pub is_gdk: bool,
}

#[derive(Debug, Deserialize)]
struct GithubVersionsJson {
    release: Option<HashMap<String, GithubVersionEntry>>,
    preview: Option<HashMap<String, GithubVersionEntry>>,
}

#[derive(Debug, Deserialize)]
struct GithubVersionEntry {
    url: Option<String>,
    urls: Option<Vec<String>>,
    is_gdk: Option<bool>,
    published_at: Option<String>,
}

pub async fn fetch_bedrock_versions() -> crate::error::Result<Vec<BedrockVersion>> {
    let client = reqwest::Client::builder()
        .user_agent("bedringh-launcher/1.0")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_default();

    let mut versions: Vec<BedrockVersion> = Vec::new();

    let urls = [
        "https://raw.githubusercontent.com/oskarlolpo000/bedrock-repacker/refs/heads/main/versions.json",
        "https://raw.githubusercontent.com/oskarlolpo/bedrock-repacker/refs/heads/main/versions.json",
        "https://raw.githubusercontent.com/oskarlolpo000/bedrock-repacker/main/versions.json",
        "https://raw.githubusercontent.com/oskarlolpo/bedrock-repacker/main/versions.json",
    ];

    let process_entry = |ver: &String, is_preview: bool, entry: &GithubVersionEntry| -> Option<BedrockVersion> {
        let identifier = if let Some(urls) = &entry.urls {
            urls.join(",")
        } else if let Some(url) = &entry.url {
            url.clone()
        } else {
            return None;
        };

        Some(BedrockVersion {
            version: ver.clone(),
            is_preview,
            identifier: identifier.clone(),
            is_gdk: entry.is_gdk.unwrap_or_else(|| {
                let id_lower = identifier.to_lowercase();
                id_lower.contains("msixvc") || id_lower.contains("bedrock_app") || id_lower.contains("gdk")
            }),
        })
    };

    let mut fetched_successfully = false;

    for url in urls {
        match client.get(url).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<GithubVersionsJson>().await {
                    Ok(data) => {
                        if let Some(releases) = data.release {
                            for (ver, entry) in &releases {
                                if let Some(v) = process_entry(ver, false, entry) {
                                    versions.push(v);
                                }
                            }
                        }
                        if let Some(previews) = data.preview {
                            for (ver, entry) in &previews {
                                if let Some(v) = process_entry(ver, true, entry) {
                                    versions.push(v);
                                }
                            }
                        }
                        if !versions.is_empty() {
                            tracing::info!("Successfully fetched {} Bedrock versions from {}", versions.len(), url);
                            fetched_successfully = true;
                            break;
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to parse Bedrock versions.json from {}: {}", url, e);
                    }
                }
            }
            Ok(resp) => {
                tracing::warn!("Non-success status ({}) fetching Bedrock versions from {}", resp.status(), url);
            }
            Err(e) => {
                tracing::warn!("Error connecting to {} for Bedrock versions: {}", url, e);
            }
        }
    }

    // Try disk cache if network fetch failed
    let cache_file = if let Ok(state) = crate::State::get().await {
        Some(state.directories.caches_dir().join("bedrock_versions_cache.json"))
    } else {
        None
    };

    if fetched_successfully {
        if let Some(ref path) = cache_file {
            if let Ok(serialized) = serde_json::to_string(&versions) {
                let _ = tokio::fs::write(path, serialized).await;
            }
        }
    } else if versions.is_empty() {
        if let Some(ref path) = cache_file {
            if path.exists() {
                if let Ok(cached_str) = tokio::fs::read_to_string(path).await {
                    if let Ok(cached_versions) = serde_json::from_str::<Vec<BedrockVersion>>(&cached_str) {
                        tracing::info!("Loaded {} Bedrock versions from local cache", cached_versions.len());
                        versions = cached_versions;
                    }
                }
            }
        }
    }

    versions.sort_by(|a, b| {
        let parse = |s: &str| -> Vec<u32> {
            s.split('-').next().unwrap_or(s).split('.').filter_map(|x| x.parse().ok()).collect()
        };
        parse(&b.version).cmp(&parse(&a.version))
    });

    Ok(versions)
}
