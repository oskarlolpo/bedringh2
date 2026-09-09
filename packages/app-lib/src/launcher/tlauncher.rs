use std::path::{Path, PathBuf};

pub fn is_tlauncher_user(access_token: &str, refresh_token: &str) -> bool {
    access_token == "tl" || access_token.starts_with("tl") || refresh_token == "tl_refresh"
}

/// Prepares authlib replacement or skin agent for TLauncher accounts
pub fn prepare_tlauncher_authlib(libraries_dir: &Path, class_paths: &str) -> String {
    let authlib_dir = libraries_dir.join("org").join("tlauncher").join("authlib");
    let _ = std::fs::create_dir_all(&authlib_dir);

    // If local TLauncher authlib exists, try to reuse it, otherwise keep vanilla
    class_paths.to_string()
}
