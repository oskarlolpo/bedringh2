use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BedrockVersion {
    pub version: String,
    pub is_preview: bool,
    pub identifier: String,
}

#[derive(Debug, Deserialize)]
struct GdkResponse {
    release: Option<std::collections::HashMap<String, Vec<String>>>,
    preview: Option<std::collections::HashMap<String, Vec<String>>>,
}

#[derive(Debug, Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name: String,
    prerelease: bool,
    assets: Vec<GhAsset>,
}

pub async fn fetch_bedrock_versions() -> crate::error::Result<Vec<BedrockVersion>> {
    let client = reqwest::Client::builder()
        .user_agent("bedringh-launcher/1.0")
        .build()
        .unwrap_or_default();

    let mut versions: Vec<BedrockVersion> = Vec::new();

    // 1. Извлекаем GDK версии
    let gdk_url = "https://raw.githubusercontent.com/MinecraftBedrockArchiver/GdkLinks/refs/heads/master/urls.min.json";
    if let Ok(resp) = client.get(gdk_url).send().await {
        if let Ok(gdk) = resp.json::<GdkResponse>().await {
            if let Some(releases) = gdk.release {
                for (ver, urls) in releases {
                    if let Some(url) = urls.first() {
                        versions.push(BedrockVersion {
                            version: format!("{}-gdk", ver),
                            is_preview: false,
                            identifier: url.clone(),
                        });
                    }
                }
            }
            if let Some(previews) = gdk.preview {
                for (ver, urls) in previews {
                    if let Some(url) = urls.first() {
                        versions.push(BedrockVersion {
                            version: format!("{}-gdk", ver),
                            is_preview: true,
                            identifier: url.clone(),
                        });
                    }
                }
            }
        }
    }

    // 2. Извлекаем UWP (.Appx) версии из OnixClient
    let mut page = 1u32;
    loop {
        let url = format!(
            "https://api.github.com/repos/OnixClient/onix_compatible_appx/releases?per_page=100&page={}",
            page
        );

        let resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Failed to fetch OnixClient releases page {}: {}", page, e);
                break;
            }
        };

        let releases: Vec<GhRelease> = match resp.json().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Failed to parse OnixClient releases page {}: {}", page, e);
                break;
            }
        };

        if releases.is_empty() {
            break;
        }

        for release in &releases {
            for asset in &release.assets {
                let lower = asset.name.to_lowercase();
                if lower.ends_with(".appx") && !lower.ends_with(".msixvc") {
                    let version = release.tag_name.trim_start_matches('v').to_string();
                    if !versions.iter().any(|v| v.version == version && v.is_preview == release.prerelease) {
                        versions.push(BedrockVersion {
                            version,
                            is_preview: release.prerelease,
                            identifier: asset.browser_download_url.clone(),
                        });
                    }
                    break;
                }
            }
        }
        page += 1;
    }

    versions.sort_by(|a, b| {
        let parse = |s: &str| -> Vec<u32> {
            s.split('-').next().unwrap_or(s).split('.').filter_map(|x| x.parse().ok()).collect()
        };
        parse(&b.version).cmp(&parse(&a.version))
    });

    Ok(versions)
}
