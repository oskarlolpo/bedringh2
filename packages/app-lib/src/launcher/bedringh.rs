use std::path::{Path, PathBuf};

pub fn is_bedringh_user(access_token: &str, refresh_token: &str) -> bool {
    access_token == "bedringh"
        || access_token.starts_with("bedringh")
        || refresh_token == "bedringh_refresh"
}

/// Prepares authlib-injector Java agent for Bedringh accounts.
/// Authlib-injector intercepts session/texture requests in Minecraft
/// and forwards them to our Bedringh Auth server (http://2.26.87.126:3100).
pub fn prepare_bedringh_authlib(libraries_dir: &Path) -> Option<PathBuf> {
    let injector_dir = libraries_dir.join("gg").join("bedringh").join("authlib-injector");
    let _ = std::fs::create_dir_all(&injector_dir);
    let target_jar = injector_dir.join("authlib-injector-1.2.5.jar");

    // Check if already present and valid (real jar is ~341 KB)
    if target_jar.exists() {
        if let Ok(meta) = target_jar.metadata() {
            if meta.len() > 100_000 {
                return Some(target_jar);
            }
        }
        let _ = std::fs::remove_file(&target_jar);
    }

    // Try multiple reliable mirrors
    let urls = [
        "http://2.26.87.126:3100/downloads/authlib-injector.jar",
        "https://github.com/yushijinhun/authlib-injector/releases/download/v1.2.5/authlib-injector-1.2.5.jar",
        "https://authlib-injector.yushijinhun.com/artifact/latest/authlib-injector.jar",
    ];

    for url in urls {
        tracing::info!("Downloading authlib-injector from {}", url);
        let status = std::process::Command::new("curl.exe")
            .args(["-f", "-sL", url, "-o", &target_jar.to_string_lossy()])
            .status();

        if let Ok(st) = status {
            if st.success() && target_jar.exists() {
                if let Ok(meta) = target_jar.metadata() {
                    if meta.len() > 100_000 {
                        tracing::info!("Successfully prepared authlib-injector: {} bytes", meta.len());
                        return Some(target_jar);
                    }
                }
            }
        }
        let _ = std::fs::remove_file(&target_jar);
    }

    tracing::warn!("Failed to download authlib-injector from all mirrors");
    None
}

/// Synchronizes the Bedringh player's skin and cape locally to an instance.
/// If the instance uses CustomSkinLoader, writes to LocalSkin/skins and LocalSkin/capes,
/// and ensures LocalSkin is prioritized in CustomSkinLoader.json so that the skin loads
/// instantly with ZERO network delay and refreshes seamlessly on world reload.
pub fn sync_skin_to_instance(
    instance_dir: &Path,
    username: &str,
    skin_bytes: &[u8],
    cape_bytes: Option<&[u8]>,
) {
    let csl_dir = instance_dir.join("CustomSkinLoader");
    let local_skin_dir = csl_dir.join("LocalSkin");
    let skins_dir = local_skin_dir.join("skins");
    let capes_dir = local_skin_dir.join("capes");

    let _ = std::fs::create_dir_all(&skins_dir);
    let _ = std::fs::create_dir_all(&capes_dir);

    let target_skin = skins_dir.join(format!("{}.png", username));
    let _ = std::fs::write(&target_skin, skin_bytes);

    if let Some(cape) = cape_bytes {
        let target_cape = capes_dir.join(format!("{}.png", username));
        let _ = std::fs::write(&target_cape, cape);
    }

    // Configure CustomSkinLoader.json to prioritize LocalSkin
    let config_path = csl_dir.join("CustomSkinLoader.json");
    if config_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&config_path) {
            if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(loadlist) = json.get_mut("loadlist").and_then(|l| l.as_array_mut()) {
                    let is_first = loadlist.first().and_then(|item| item.get("name")).and_then(|n| n.as_str()) == Some("LocalSkin");
                    if !is_first {
                        let mut local_skin_entry = None;
                        if let Some(pos) = loadlist.iter().position(|item| item.get("name").and_then(|n| n.as_str()) == Some("LocalSkin")) {
                            local_skin_entry = Some(loadlist.remove(pos));
                        }

                        let entry = local_skin_entry.unwrap_or_else(|| {
                            serde_json::json!({
                                "name": "LocalSkin",
                                "type": "Legacy",
                                "checkPNG": false,
                                "skin": "LocalSkin/skins/{USERNAME}.png",
                                "model": "auto",
                                "cape": "LocalSkin/capes/{USERNAME}.png",
                                "elytra": "LocalSkin/elytras/{USERNAME}.png"
                            })
                        });

                        loadlist.insert(0, entry);
                        if let Ok(new_content) = serde_json::to_string_pretty(&json) {
                            let _ = std::fs::write(&config_path, new_content);
                        }
                    }
                }
            }
        }
    }
}

/// Synchronizes skin and cape across all instances in the profiles directory.
pub fn sync_skin_to_all_instances(
    profiles_dir: &Path,
    username: &str,
    skin_bytes: &[u8],
    cape_bytes: Option<&[u8]>,
) {
    if let Ok(entries) = std::fs::read_dir(profiles_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                sync_skin_to_instance(&path, username, skin_bytes, cape_bytes);
            }
        }
    }
}
