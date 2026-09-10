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

    if target_jar.exists() {
        if let Ok(meta) = target_jar.metadata() {
            if meta.len() > 1024 {
                return Some(target_jar);
            }
        }
        let _ = std::fs::remove_file(&target_jar);
    }

    // Download authlib-injector if missing
    let url = "https://authlib-injector.yushijinhun.com/artifact/latest/authlib-injector.jar";
    let _ = std::process::Command::new("curl.exe")
        .args(["-f", "-sL", url, "-o", &target_jar.to_string_lossy()])
        .output();

    if target_jar.exists() {
        if let Ok(meta) = target_jar.metadata() {
            if meta.len() > 1024 {
                return Some(target_jar);
            }
        }
        let _ = std::fs::remove_file(&target_jar);
    }

    None
}
