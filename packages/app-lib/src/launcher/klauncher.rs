use std::path::{Path, PathBuf};
use crate::data::ModLoader;

pub fn is_klauncher_user(access_token: &str, refresh_token: &str) -> bool {
    access_token == "kl" || access_token.starts_with("kl") || refresh_token == "kl_refresh"
}

pub fn get_authlib_jar_name(game_version: &str, class_paths: &str) -> &'static str {
    let v = game_version.trim();
    if v.starts_with("1.7.") {
        "1.7.9-1.7.10.jar"
    } else if v.starts_with("1.8")
        || v.starts_with("1.9")
        || v.starts_with("1.10")
        || v.starts_with("1.11")
        || v.starts_with("1.12")
        || v.starts_with("1.13")
        || v.starts_with("1.14")
        || v.starts_with("1.15")
        || (v.starts_with("1.16.") && !v.starts_with("1.16.4") && !v.starts_with("1.16.5"))
    {
        "1.8-1.16.3.jar"
    } else if v.starts_with("1.16.4")
        || v.starts_with("1.16.5")
        || v.starts_with("1.17")
        || v.starts_with("1.18")
        || v == "1.19"
    {
        "1.16.4-1.19.jar"
    } else if v.starts_with("1.19.")
        || v == "1.20"
        || v == "1.20.1"
    {
        "1.19.1-1.20.1.jar"
    } else if v.starts_with("1.20.2") {
        "1.20.2.jar"
    } else if v.starts_with("1.20.")
        || (v.starts_with("1.21.")
            && !v.starts_with("1.21.9")
            && !v.starts_with("1.21.10")
            && !v.starts_with("1.21.11"))
        || v == "1.21"
    {
        "1.20.3-1.21.8.jar"
    } else if v.starts_with("1.21.9")
        || v.starts_with("1.21.10")
        || v.starts_with("1.21.11")
        || v.starts_with("26.1")
    {
        "1.21.9-26.1.2.jar"
    } else if v.starts_with("26.") {
        "26.2.jar"
    } else {
        // Fallback using class paths
        if class_paths.contains("authlib-6.")
            || class_paths.contains("authlib-5.")
            || class_paths.contains("authlib-4.")
        {
            "1.21.9-26.1.2.jar"
        } else if class_paths.contains("authlib-3.") {
            "1.19.1-1.20.1.jar"
        } else {
            "1.16.4-1.19.jar"
        }
    }
}

pub fn prepare_klauncher_authlib(
    libraries_dir: &Path,
    class_paths: &str,
    game_version: &str,
) -> String {
    let authlib_dir = libraries_dir.join("gg").join("klauncher").join("authlib");
    let _ = std::fs::create_dir_all(&authlib_dir);

    let jar_name = get_authlib_jar_name(game_version, class_paths);
    let target_jar = authlib_dir.join(jar_name);

    // If target_jar exists but is corrupt or empty, remove it
    if target_jar.exists() {
        if let Ok(meta) = target_jar.metadata() {
            if meta.len() < 1024 {
                let _ = std::fs::remove_file(&target_jar);
            }
        } else {
            let _ = std::fs::remove_file(&target_jar);
        }
    }

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
            if klauncher_jar.exists()
                && klauncher_jar
                    .metadata()
                    .map(|m| m.len() > 1024)
                    .unwrap_or(false)
            {
                let _ = std::fs::copy(&klauncher_jar, &target_jar);
            }
        }
    }

    if !target_jar.exists() {
        // Download via curl from official KLauncher 4.3 authlib repository
        let url = format!("https://repos.klaun.ch/authlib/4.3/{}", jar_name);
        tracing::info!("Downloading KLauncher Authlib from {}", url);
        let _ = std::process::Command::new("curl.exe")
            .args(["-f", "-sL", &url, "-o", &target_jar.to_string_lossy()])
            .output();

        // If download failed or created an invalid/empty file, clean it up immediately
        if target_jar.exists()
            && target_jar
                .metadata()
                .map(|m| m.len() < 1024)
                .unwrap_or(true)
        {
            let _ = std::fs::remove_file(&target_jar);
        }
    }

    // Verify zip archive integrity (magic bytes PK\x03\x04 and size > 1KB)
    let is_valid_jar = if target_jar.exists() {
        if let Ok(meta) = target_jar.metadata() {
            if meta.len() > 1024 {
                if let Ok(mut f) = std::fs::File::open(&target_jar) {
                    use std::io::Read;
                    let mut magic = [0u8; 4];
                    f.read_exact(&mut magic).is_ok() && &magic == b"PK\x03\x04"
                } else {
                    false
                }
            } else {
                false
            }
        } else {
            false
        }
    } else {
        false
    };

    if !is_valid_jar && target_jar.exists() {
        let _ = std::fs::remove_file(&target_jar);
    }

    if is_valid_jar {
        tracing::info!("Using KLauncher Authlib: {:?}", target_jar);
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

    tracing::warn!("KLauncher Authlib could not be prepared, falling back to vanilla authlib");
    class_paths.to_string()
}

pub fn get_klmaster_jar_name(loader_prefix: &str, game_version: &str) -> Option<String> {
    let v = game_version.trim();

    if loader_prefix == "fabric" {
        let range = if v >= "1.14" && v <= "1.14.4" {
            "1.14-1.14.4"
        } else if v >= "1.15" && v <= "1.15.2" {
            "1.15-1.15.2"
        } else if v == "1.16" || v == "1.16.1" {
            "1.16-1.16.1"
        } else if v >= "1.16.2" && v <= "1.16.5" {
            "1.16.2-1.16.5"
        } else if v == "1.17" || v == "1.17.1" {
            "1.17-1.17.1"
        } else if v >= "1.18" && v <= "1.18.2" {
            "1.18-1.18.2"
        } else if v == "1.19" {
            "1.19"
        } else if v == "1.19.1" || v == "1.19.2" {
            "1.19.1-1.19.2"
        } else if v == "1.19.3" || v == "1.19.4" {
            "1.19.3-1.19.4"
        } else if v == "1.20" || v == "1.20.1" {
            "1.20-1.20.1"
        } else if v == "1.20.2" {
            "1.20.2"
        } else if v == "1.20.3" || v == "1.20.4" {
            "1.20.3-1.20.4"
        } else if v == "1.20.5" || v == "1.20.6" {
            "1.20.5-1.20.6"
        } else if v == "1.21" || v == "1.21.1" {
            "1.21-1.21.1"
        } else if v == "1.21.2" || v == "1.21.3" {
            "1.21.2-1.21.3"
        } else if v == "1.21.4" {
            "1.21.4"
        } else if v == "1.21.5" {
            "1.21.5"
        } else if v >= "1.21.6" && v <= "1.21.8" {
            "1.21.6-1.21.8"
        } else if v == "1.21.9" || v == "1.21.10" {
            "1.21.9-1.21.10"
        } else if v == "1.21.11" {
            "1.21.11"
        } else if v.starts_with("26.1") {
            "26.1-26.1.2"
        } else if v.starts_with("26.2") {
            "26.2"
        } else {
            return None;
        };
        Some(format!("klmaster-fabric-{}.jar", range))
    } else if loader_prefix == "forge" {
        let range = if v == "1.14.4" {
            "1.14.4"
        } else if v >= "1.15" && v <= "1.15.2" {
            "1.15-1.15.2"
        } else if v == "1.16.1" {
            "1.16.1"
        } else if v >= "1.16.2" && v <= "1.16.5" {
            "1.16.2-1.16.5"
        } else if v == "1.17.1" {
            "1.17.1"
        } else if v >= "1.18" && v <= "1.18.2" {
            "1.18-1.18.2"
        } else if v == "1.19" {
            "1.19"
        } else if v == "1.19.1" || v == "1.19.2" {
            "1.19.1-1.19.2"
        } else if v == "1.19.3" || v == "1.19.4" {
            "1.19.3-1.19.4"
        } else if v == "1.20" || v == "1.20.1" {
            "1.20-1.20.1"
        } else if v == "1.20.2" {
            "1.20.2"
        } else if v == "1.20.3" || v == "1.20.4" {
            "1.20.3-1.20.4"
        } else if v == "1.20.5" || v == "1.20.6" {
            "1.20.5-1.20.6"
        } else if v == "1.21" || v == "1.21.1" {
            "1.21-1.21.1"
        } else if v == "1.21.2" || v == "1.21.3" {
            "1.21.2-1.21.3"
        } else if v == "1.21.4" {
            "1.21.4"
        } else if v == "1.21.5" {
            "1.21.5"
        } else if v >= "1.21.6" && v <= "1.21.8" {
            "1.21.6-1.21.8"
        } else if v == "1.21.9" || v == "1.21.10" {
            "1.21.9-1.21.10"
        } else if v == "1.21.11" {
            "1.21.11"
        } else if v.starts_with("26.1") {
            "26.1-26.1.2"
        } else if v.starts_with("26.2") {
            "26.2"
        } else {
            return None;
        };
        Some(format!("klmaster-forge-{}.jar", range))
    } else if loader_prefix == "neoforge" {
        let range = if v == "1.20" || v == "1.20.1" {
            "1.20-1.20.1"
        } else if v == "1.20.2" {
            "1.20.2"
        } else if v == "1.20.3" || v == "1.20.4" {
            "1.20.3-1.20.4"
        } else if v == "1.20.5" || v == "1.20.6" {
            "1.20.5-1.20.6"
        } else if v == "1.21" || v == "1.21.1" {
            "1.21-1.21.1"
        } else if v == "1.21.2" || v == "1.21.3" {
            "1.21.2-1.21.3"
        } else if v == "1.21.4" {
            "1.21.4"
        } else if v == "1.21.5" {
            "1.21.5"
        } else if v >= "1.21.6" && v <= "1.21.8" {
            "1.21.6-1.21.8"
        } else if v == "1.21.9" || v == "1.21.10" {
            "1.21.9-1.21.10"
        } else if v == "1.21.11" {
            "1.21.11"
        } else if v.starts_with("26.1") {
            "26.1-26.1.2"
        } else if v.starts_with("26.2") {
            "26.2"
        } else {
            return None;
        };
        Some(format!("klmaster-neoforge-{}.jar", range))
    } else {
        None
    }
}

pub fn inject_klmaster_mod(
    libraries_dir: &Path,
    instance_path: &Path,
    loader: ModLoader,
    game_version: &str,
) {
    if loader == ModLoader::Vanilla || loader == ModLoader::Bedrock {
        return;
    }

    let mods_dir = instance_path.join("mods");
    let _ = std::fs::create_dir_all(&mods_dir);

    // Clean up old or mis-injected klmaster mods from previous launches
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

    let Some(jar_name) = get_klmaster_jar_name(loader_prefix, game_version) else {
        tracing::warn!(
            "No matching klmaster mod found for loader {} and version {}",
            loader_prefix,
            game_version
        );
        return;
    };

    let cache_dir = libraries_dir.join("gg").join("klauncher").join("klmaster");
    let _ = std::fs::create_dir_all(&cache_dir);
    let cached_jar = cache_dir.join(&jar_name);

    // If cached_jar doesn't exist or is invalid, try downloading from official KLauncher 4.5 repository
    let is_valid = if cached_jar.exists() {
        if let Ok(meta) = cached_jar.metadata() {
            meta.len() > 1024
        } else {
            false
        }
    } else {
        false
    };

    if !is_valid {
        let url = format!("https://repos.klaun.ch/klmaster/4.5/{}", jar_name);
        tracing::info!("Downloading KLMaster mod from {}", url);
        let _ = std::process::Command::new("curl.exe")
            .args(["-f", "-sL", &url, "-o", &cached_jar.to_string_lossy()])
            .output();
    }

    if cached_jar.exists() && cached_jar.metadata().map(|m| m.len() > 1024).unwrap_or(false) {
        let dest = mods_dir.join(&jar_name);
        let _ = std::fs::copy(&cached_jar, &dest);
        tracing::info!("Successfully injected KLMaster mod: {:?}", dest);

        // For Forge 1.15.2+, also inject MixinBootstrap if needed
        if loader == ModLoader::Forge && game_version >= "1.15.2" {
            let mixin_jar = cache_dir.join("MixinBootstrap.jar");
            if !mixin_jar.exists() || mixin_jar.metadata().map(|m| m.len() < 1024).unwrap_or(true) {
                let url = "https://repos.klaun.ch/mixin/MixinBootstrap.jar";
                let _ = std::process::Command::new("curl.exe")
                    .args(["-f", "-sL", url, "-o", &mixin_jar.to_string_lossy()])
                    .output();
            }
            if mixin_jar.exists() && mixin_jar.metadata().map(|m| m.len() > 1024).unwrap_or(false) {
                let mixin_dest = mods_dir.join("MixinBootstrap.jar");
                let _ = std::fs::copy(&mixin_jar, &mixin_dest);
            }
        }
    } else {
        tracing::warn!("Failed to obtain KLMaster mod: {}", jar_name);
    }
}

pub fn prepare_klagent(libraries_dir: &Path) -> Option<PathBuf> {
    let agent_dir = libraries_dir.join("gg").join("klauncher").join("klagent");
    let _ = std::fs::create_dir_all(&agent_dir);
    let agent_jar = agent_dir.join("klagent.jar");

    if !agent_jar.exists() || agent_jar.metadata().map(|m| m.len() < 1024).unwrap_or(true) {
        let url = "https://repos.klaun.ch/klagent/3.0/klagent.jar";
        tracing::info!("Downloading KLAgent from {}", url);
        let _ = std::process::Command::new("curl.exe")
            .args(["-f", "-sL", url, "-o", &agent_jar.to_string_lossy()])
            .output();
    }

    if agent_jar.exists() && agent_jar.metadata().map(|m| m.len() > 1024).unwrap_or(false) {
        Some(agent_jar)
    } else {
        None
    }
}

/// Ensures %APPDATA%\KLauncher\config.json is configured to enable skins and icons
pub fn ensure_klauncher_config() {
    let Ok(appdata) = std::env::var("APPDATA") else {
        return;
    };
    let kl_dir = PathBuf::from(appdata).join("KLauncher");
    let _ = std::fs::create_dir_all(&kl_dir);
    let config_file = kl_dir.join("config.json");

    let mut val: serde_json::Value = if config_file.exists() {
        std::fs::read_to_string(&config_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if !val.is_object() {
        val = serde_json::json!({});
    }

    val["game"]["kl"]["useSkins"] = serde_json::Value::Bool(true);
    val["game"]["kl"]["allowNSFW"] = serde_json::Value::Bool(true);
    val["game"]["kl"]["master"]["enabled"] = serde_json::Value::Bool(true);
    val["game"]["kl"]["master"]["icons"]["tab"] = serde_json::Value::Bool(true);
    val["game"]["kl"]["master"]["icons"]["head"] = serde_json::Value::Bool(true);

    if let Ok(formatted) = serde_json::to_string_pretty(&val) {
        let _ = std::fs::write(&config_file, formatted);
    }
}

/// Disables CustomSkinLoader and clears legacy local skins so KLauncher Authlib handles skins natively
pub fn cleanup_klauncher_instance(instance_path: &Path) {
    let mods_dir = instance_path.join("mods");
    if let Ok(entries) = std::fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(file_name) = path.file_name().and_then(|s| s.to_str()) {
                if file_name.starts_with("CustomSkinLoader") && file_name.ends_with(".jar") {
                    let disabled_path = mods_dir.join(format!("{}.disabled", file_name));
                    let _ = std::fs::rename(&path, &disabled_path);
                    tracing::info!("Temporarily disabled CustomSkinLoader for KLauncher profile: {:?}", disabled_path);
                }
            }
        }
    }

    let local_skins = instance_path.join("CustomSkinLoader").join("LocalSkin").join("skins");
    if let Ok(entries) = std::fs::read_dir(&local_skins) {
        for entry in entries.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }

    let local_capes = instance_path.join("CustomSkinLoader").join("LocalSkin").join("capes");
    if let Ok(entries) = std::fs::read_dir(&local_capes) {
        for entry in entries.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Restores CustomSkinLoader when switching back to Bedringh profile
pub fn restore_bedringh_csl(instance_path: &Path) {
    let mods_dir = instance_path.join("mods");
    if let Ok(entries) = std::fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(file_name) = path.file_name().and_then(|s| s.to_str()) {
                if file_name.starts_with("CustomSkinLoader") && file_name.ends_with(".jar.disabled") {
                    let enabled_name = file_name.trim_end_matches(".disabled");
                    let enabled_path = mods_dir.join(enabled_name);
                    let _ = std::fs::rename(&path, &enabled_path);
                    tracing::info!("Re-enabled CustomSkinLoader for Bedringh profile: {:?}", enabled_path);
                }
            }
        }
    }
}

/// Automatically ensures EnvyWorld (play.envyworld.gg) is added to servers.dat
pub async fn ensure_envyworld_server(instance_path: &Path) {
    let servers_path = instance_path.join("servers.dat");
    let mut servers = crate::api::instance::synced_servers::read_servers(&servers_path)
        .await
        .unwrap_or_default();

    let envy_ip = "play.envyworld.gg";
    let already_has = servers.iter().any(|s| {
        s.get::<_, &str>("ip")
            .map(|ip| ip.eq_ignore_ascii_case(envy_ip) || ip.starts_with("play.envyworld.gg:"))
            .unwrap_or(false)
    });

    if !already_has {
        let entry = crate::api::instance::synced_servers::server_data(
            "EnvyWorld.gg".to_string(),
            format!("{}:25565", envy_ip),
            Some(true),
        );
        servers.insert(0, entry);
        let _ = crate::api::instance::synced_servers::write_servers(&servers_path, &servers).await;
        tracing::info!("Added EnvyWorld.gg to servers.dat at {:?}", servers_path);
    }
}

// ---------------------------------------------------------------------------
// KLauncher WebSocket Bridge (Emulates KLauncher official client for EnvyWorld)
// ---------------------------------------------------------------------------

use once_cell::sync::Lazy;
use std::collections::HashMap;
use tokio::sync::{watch, oneshot, Mutex};

struct ActiveBridgeSession {
    server_tx: watch::Sender<Option<(String, u16)>>,
    stop_tx: Option<oneshot::Sender<()>>,
}

static BRIDGE_SESSIONS: Lazy<Mutex<HashMap<String, Vec<ActiveBridgeSession>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn get_klid() -> String {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("reg");
        cmd.args(["query", r"HKCU\Software\8b331812beca39d864c15c2a205146a5", "/v", "id"]);
        cmd.creation_flags(0x0800_0000);
        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    if line.contains("id") && line.contains("REG_SZ") {
                        if let Some(val) = line.split("REG_SZ").nth(1) {
                            let trimmed = val.trim();
                            if !trimmed.is_empty() {
                                return trimmed.to_string();
                            }
                        }
                    }
                }
            }
        }
    }
    "d86aa9cafe1e41d78b63340bc64118fa".to_string()
}

#[cfg(windows)]
pub fn ensure_klauncher_routes() {
    use std::os::windows::process::CommandExt;
    let gateway = "192.168.31.1";
    let if_idx = "18";
    let routes = [
        ("212.41.10.243", "255.255.255.255"),
        ("188.127.241.0", "255.255.255.0"),
        ("104.167.24.0", "255.255.255.0"),
    ];
    for (dest, mask) in routes {
        let mut cmd = std::process::Command::new("route");
        cmd.args(["add", dest, "mask", mask, gateway, "metric", "1", "if", if_idx]);
        cmd.creation_flags(0x0800_0000);
        let _ = cmd.output();
    }
}

pub fn get_klauncher_token(username: &str) -> String {
    if username.eq_ignore_ascii_case("wink0o000000") {
        return "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6IndpbmswbzAwMDAwMCIsInN1YiI6IjI3NjUyNjQiLCJwdiI6IjIxZmQ1ODkyNGQyNzViMzYiLCJpYXQiOjE3ODkzODk5MzEsImV4cCI6MTgyMDkyNTkzMX0.GvMMCSaSe2McGeBZgW1hCsEqsIrIvdqcrs_lOE7M-xY".to_string();
    }
    if username.eq_ignore_ascii_case("oskarlolpo") || username.eq_ignore_ascii_case("oskarlolpo666") {
        return "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6Im9za2FybG9scG8iLCJzdWIiOiI4ODk3OTciLCJwdiI6IjIxZmQ1ODkyNGQyNzViMzYiLCJpYXQiOjE3ODgzNzU0NjMsImV4cCI6MTgxOTkxMTQ2M30.mkbumk9bcqqIb0PK7kVSVg4ljXcCRDBS_9bCwhngz6c".to_string();
    }
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6IndpbmswbzAwMDAwMCIsInN1YiI6IjI3NjUyNjQiLCJwdiI6IjIxZmQ1ODkyNGQyNzViMzYiLCJpYXQiOjE3ODkzODk5MzEsImV4cCI6MTgyMDkyNTkzMX0.GvMMCSaSe2McGeBZgW1hCsEqsIrIvdqcrs_lOE7M-xY".to_string()
}

async fn run_klauncher_socket_session(
    username: String,
    token: String,
    klid: String,
    mut server_rx: watch::Receiver<Option<(String, u16)>>,
    mut stop_rx: oneshot::Receiver<()>,
) {
    let client = match reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => reqwest::Client::new(),
    };

    let base_url = "https://api.klaun.ch/v2/chat/socket.io/?EIO=4&transport=polling";

    // 1. Engine.IO Handshake
    let handshake_res = match client.get(base_url).send().await {
        Ok(res) => res.text().await.unwrap_or_default(),
        Err(e) => {
            tracing::warn!("KLauncher bridge handshake failed for {}: {}", username, e);
            return;
        }
    };

    if !handshake_res.starts_with('0') {
        tracing::warn!("KLauncher bridge invalid handshake: {}", handshake_res);
        return;
    }

    let Ok(handshake_json): Result<serde_json::Value, _> = serde_json::from_str(&handshake_res[1..]) else {
        return;
    };

    let Some(sid) = handshake_json.get("sid").and_then(|s| s.as_str()) else {
        return;
    };
    let sid = sid.to_string();
    tracing::info!("KLauncher bridge connected for {} with sid {}", username, sid);

    // 2. Socket.IO Connect & Auth into /chat namespace (40/chat, + payload)
    let auth_payload = serde_json::json!({
        "token": token,
        "klid": klid,
        "username": username
    });
    let auth_packet = format!("40/chat,{}", auth_payload);
    let session_url = format!("{}&sid={}", base_url, sid);
    let _ = client
        .post(&session_url)
        .header("Content-Type", "text/plain;charset=UTF-8")
        .body(auth_packet)
        .send()
        .await;

    // 3. Initial emit if server is currently set
    let mut current_server: Option<(String, u16)> = server_rx.borrow().clone();
    if let Some((ref ip, port)) = current_server {
        let emit_payload = serde_json::json!(["playingServer", { "server": { "ip": ip, "port": port } }]);
        let _ = client
            .post(&session_url)
            .header("Content-Type", "text/plain;charset=UTF-8")
            .body(format!("42/chat,{}", emit_payload))
            .send()
            .await;
        tracing::info!("KLauncher bridge initial playingServer sent for {} on {}:{}", username, ip, port);
    }

    let mut ping_interval = tokio::time::interval(std::time::Duration::from_secs(15));

    loop {
        tokio::select! {
            _ = &mut stop_rx => {
                tracing::info!("Stopping KLauncher bridge for {}", username);
                let emit_payload = serde_json::json!(["playingServer", { "server": null }]);
                let _ = client
                    .post(&session_url)
                    .header("Content-Type", "text/plain;charset=UTF-8")
                    .body(format!("42/chat,{}", emit_payload))
                    .send()
                    .await;
                break;
            }
            Ok(()) = server_rx.changed() => {
                let new_server = server_rx.borrow().clone();
                if new_server != current_server {
                    current_server = new_server;
                    let payload = if let Some((ref ip, port)) = current_server {
                        serde_json::json!(["playingServer", { "server": { "ip": ip, "port": port } }])
                    } else {
                        serde_json::json!(["playingServer", { "server": null }])
                    };
                    let _ = client
                        .post(&session_url)
                        .header("Content-Type", "text/plain;charset=UTF-8")
                        .body(format!("42/chat,{}", payload))
                        .send()
                        .await;
                    tracing::info!("KLauncher bridge updated playingServer for {}: {:?}", username, current_server);
                }
            }
            _ = ping_interval.tick() => {
                if let Some((ref ip, port)) = current_server {
                    let payload = serde_json::json!(["playingServer", { "server": { "ip": ip, "port": port } }]);
                    let _ = client
                        .post(&session_url)
                        .header("Content-Type", "text/plain;charset=UTF-8")
                        .body(format!("42/chat,{}", payload))
                        .send()
                        .await;
                }
            }
        }
    }
}

pub async fn start_klauncher_bridge(instance_id: &str, username: &str) {
    #[cfg(windows)]
    ensure_klauncher_routes();

    let klid = get_klid();
    let mut targets = Vec::new();
    if !username.trim().is_empty() {
        let u = username.trim().to_string();
        let tok = get_klauncher_token(&u);
        targets.push((u, tok));
    }
    // Also add wink0o000000 and oskarlolpo if not already added
    if !targets.iter().any(|(u, _)| u.eq_ignore_ascii_case("wink0o000000")) {
        targets.push(("wink0o000000".to_string(), get_klauncher_token("wink0o000000")));
    }
    if !targets.iter().any(|(u, _)| u.eq_ignore_ascii_case("oskarlolpo")) {
        targets.push(("oskarlolpo".to_string(), get_klauncher_token("oskarlolpo")));
    }

    let default_server = Some(("play.envyworld.gg".to_string(), 25565));
    let mut session_list = Vec::new();

    for (nick, token) in targets {
        let (server_tx, server_rx) = watch::channel(default_server.clone());
        let (stop_tx, stop_rx) = oneshot::channel();

        let nick_clone = nick.clone();
        let token_clone = token.clone();
        let klid_clone = klid.clone();
        tokio::spawn(async move {
            run_klauncher_socket_session(nick_clone, token_clone, klid_clone, server_rx, stop_rx).await;
        });

        session_list.push(ActiveBridgeSession {
            server_tx,
            stop_tx: Some(stop_tx),
        });
    }

    let mut lock = BRIDGE_SESSIONS.lock().await;
    lock.insert(instance_id.to_string(), session_list);
    tracing::info!("KLauncher bridge registered for instance {}", instance_id);
}

pub async fn notify_playing_server(instance_id: &str, host: &str, port: u16) {
    let lock = BRIDGE_SESSIONS.lock().await;
    if let Some(sessions) = lock.get(instance_id) {
        for s in sessions {
            let _ = s.server_tx.send(Some((host.to_string(), port)));
        }
    }
}

pub async fn stop_klauncher_bridge(instance_id: &str) {
    let mut lock = BRIDGE_SESSIONS.lock().await;
    if let Some(mut sessions) = lock.remove(instance_id) {
        for s in &mut sessions {
            if let Some(tx) = s.stop_tx.take() {
                let _ = tx.send(());
            }
        }
        tracing::info!("KLauncher bridge stopped for instance {}", instance_id);
    }
}

