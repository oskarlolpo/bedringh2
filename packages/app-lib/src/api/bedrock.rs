use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BedrockVersion {
    pub version: String,
    pub is_preview: bool,
    pub identifier: String,
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
        .build()
        .unwrap_or_default();

    let mut versions: Vec<BedrockVersion> = Vec::new();

    // Fetch versions from the bedrock-repacker repository
    let url = "https://raw.githubusercontent.com/oskarlolpo/bedrock-repacker/refs/heads/main/versions.json";
    
    if let Ok(resp) = client.get(url).send().await {
        if let Ok(data) = resp.json::<GithubVersionsJson>().await {
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
                    identifier,
                })
            };

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
        } else {
            tracing::warn!("Failed to parse Bedrock versions.json from GitHub");
        }
    } else {
        tracing::warn!("Failed to fetch Bedrock versions.json from GitHub");
    }

    versions.sort_by(|a, b| {
        let parse = |s: &str| -> Vec<u32> {
            s.split('-').next().unwrap_or(s).split('.').filter_map(|x| x.parse().ok()).collect()
        };
        parse(&b.version).cmp(&parse(&a.version))
    });

    Ok(versions)
}
