use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BedrockVersion {
    pub version: String,
    pub is_preview: bool,
    pub identifier: String,
}

#[derive(Debug, Deserialize)]
struct GdkResponse {
    release: Option<HashMap<String, Vec<String>>>,
    preview: Option<HashMap<String, Vec<String>>>,
}

pub async fn fetch_bedrock_versions() -> crate::error::Result<Vec<BedrockVersion>> {
    let client = reqwest::Client::new();
    let mut versions = Vec::new();

    if let Ok(gdk_req) = client
        .get("https://raw.githubusercontent.com/MinecraftBedrockArchiver/GdkLinks/refs/heads/master/urls.min.json")
        .send()
        .await
    {
        if let Ok(gdk_text) = gdk_req.text().await {
            if let Ok(gdk_json) = serde_json::from_str::<GdkResponse>(&gdk_text) {
                if let Some(release_map) = gdk_json.release {
                    for (version, urls) in release_map {
                        if let Some(first_url) = urls.first() {
                            versions.push(BedrockVersion {
                                version,
                                is_preview: false,
                                identifier: first_url.clone(),
                            });
                        }
                    }
                }
                if let Some(preview_map) = gdk_json.preview {
                    for (version, urls) in preview_map {
                        if let Some(first_url) = urls.first() {
                            versions.push(BedrockVersion {
                                version,
                                is_preview: true,
                                identifier: first_url.clone(),
                            });
                        }
                    }
                }
            }
        }
    }

    // Fetch UWP (w10) release versions
    if let Ok(resp) = client
        .get("https://raw.githubusercontent.com/MinecraftBedrockArchiver/Metadata/master/w10_meta.json")
        .send()
        .await
    {
        if let Ok(text) = resp.text().await {
            if let Ok(map) = serde_json::from_str::<HashMap<String, serde_json::Value>>(&text) {
                for (version, _) in map {
                    // Avoid duplicates from GDK
                    if !versions.iter().any(|v: &BedrockVersion| v.version == version && !v.is_preview) {
                        versions.push(BedrockVersion {
                            version,
                            is_preview: false,
                            identifier: "UWP".to_string(),
                        });
                    }
                }
            }
        }
    }

    // Fetch UWP (w10) preview versions
    if let Ok(resp) = client
        .get("https://raw.githubusercontent.com/MinecraftBedrockArchiver/Metadata/master/w10_preview_meta.json")
        .send()
        .await
    {
        if let Ok(text) = resp.text().await {
            if let Ok(map) = serde_json::from_str::<HashMap<String, serde_json::Value>>(&text) {
                for (version, _) in map {
                    if !versions.iter().any(|v: &BedrockVersion| v.version == version && v.is_preview) {
                        versions.push(BedrockVersion {
                            version,
                            is_preview: true,
                            identifier: "UWP".to_string(),
                        });
                    }
                }
            }
        }
    }

    versions.sort_by(|a, b| {
        let a_parts: Vec<u32> = a.version.split('.').filter_map(|s| s.parse().ok()).collect();
        let b_parts: Vec<u32> = b.version.split('.').filter_map(|s| s.parse().ok()).collect();
        b_parts.cmp(&a_parts)
    });

    Ok(versions)
}
