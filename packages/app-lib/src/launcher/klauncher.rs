use std::path::{Path, PathBuf};
use crate::data::ModLoader;

pub fn is_klauncher_user(access_token: &str, refresh_token: &str) -> bool {
    access_token == "kl" || access_token.starts_with("kl") || refresh_token == "kl_refresh"
}

pub fn prepare_klauncher_authlib(libraries_dir: &Path, class_paths: &str) -> String {
    let authlib_dir = libraries_dir.join("gg").join("klauncher").join("authlib");
    let _ = std::fs::create_dir_all(&authlib_dir);

    let jar_name = if class_paths.contains("authlib-6.") || class_paths.contains("authlib-5.") || class_paths.contains("authlib-4.") {
        "1.21.9-26.1.2.jar"
    } else {
        "1.16.4-1.19.jar"
    };

    let target_jar = authlib_dir.join(jar_name);

    if !target_jar.exists() {
        // Try copying from local KLauncher installation if available
        if let Ok(appdata) = std::env::var("APPDATA") {
            let klauncher_jar = PathBuf::from(appdata)
                .join("KLauncher")
                .join("game")
                .join("libraries")
                .join("gg")
                .join("klauncher")
                .join("authlib")
                .join(jar_name);
            if klauncher_jar.exists() {
                let _ = std::fs::copy(&klauncher_jar, &target_jar);
            }
        }
    }

    if !target_jar.exists() {
        // Download via curl if still missing
        let url = format!("https://repos.klaun.ch/authlib/{}", jar_name);
        let _ = std::process::Command::new("curl.exe")
            .args(["-sL", &url, "-o", &target_jar.to_string_lossy()])
            .output();
    }

    if target_jar.exists() {
        let target_str = target_jar.to_string_lossy().to_string();
        let sep = if cfg!(windows) { ";" } else { ":" };
        let parts: Vec<&str> = class_paths.split(sep).collect();
        let mut new_parts = Vec::new();
        for part in parts {
            if part.contains("mojang") && part.contains("authlib") {
                new_parts.push(target_str.as_str());
            } else {
                new_parts.push(part);
            }
        }
        return new_parts.join(sep);
    }

    class_paths.to_string()
}

pub fn inject_klmaster_mod(instance_path: &Path, loader: ModLoader, game_version: &str) {
    if loader == ModLoader::Vanilla || loader == ModLoader::Bedrock {
        return;
    }

    let mods_dir = instance_path.join("mods");
    let _ = std::fs::create_dir_all(&mods_dir);

    // Clean up any old or mis-injected klmaster mods from previous launches
    if let Ok(entries) = std::fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let filename = entry.file_name().to_string_lossy().to_string();
            if filename.starts_with("klmaster-") && filename.ends_with(".jar") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    let loader_prefix = match loader {
        ModLoader::Fabric | ModLoader::Quilt => "fabric",
        ModLoader::Forge => "forge",
        ModLoader::NeoForge => "neoforge",
        _ => return,
    };

    let temp_mods = PathBuf::from(r"C:\Users\evgenij\AppData\Local\Temp\klmaster_mods");
    if temp_mods.exists() {
        if let Ok(entries) = std::fs::read_dir(&temp_mods) {
            for entry in entries.flatten() {
                let path = entry.path();
                let filename = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                
                // Match loader and version (e.g. klmaster-fabric-1.16.2-1.16.5.jar or klmaster-fabric-1.16.5)
                if filename.starts_with(&format!("klmaster-{loader_prefix}")) {
                    let version_part = filename
                        .trim_start_matches(&format!("klmaster-{loader_prefix}-"))
                        .trim_end_matches(".jar");
                    
                    let matches_version = if version_part.contains('-') {
                        let parts: Vec<&str> = version_part.split('-').collect();
                        if parts.len() == 2 {
                            game_version >= parts[0] && game_version <= parts[1]
                        } else {
                            false
                        }
                    } else {
                        game_version == version_part
                    };

                    if matches_version {
                        let dest = mods_dir.join(path.file_name().unwrap());
                        let _ = std::fs::copy(&path, &dest);
                        break;
                    }
                }
            }
        }
    }
}
