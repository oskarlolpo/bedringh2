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
