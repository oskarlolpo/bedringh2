use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::OnceCell;

pub fn is_bedringh_user(access_token: &str, refresh_token: &str) -> bool {
    access_token == "bedringh"
        || access_token.starts_with("bedringh")
        || refresh_token == "bedringh_refresh"
        || access_token == "offline"
        || access_token == "null"
        || access_token.is_empty()
        || refresh_token == "offline"
        || refresh_token == "null"
}

/// Prepares authlib-injector Java agent for Bedringh accounts.
/// Authlib-injector intercepts session/texture requests in Minecraft
/// and forwards them to our Bedringh Auth server (http://bedringh.duckdns.org:3100).
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

    // Try multiple reliable mirrors (reliable https mirrors first, fast timeout)
    let urls = [
        "https://github.com/yushijinhun/authlib-injector/releases/download/v1.2.5/authlib-injector-1.2.5.jar",
        "https://authlib-injector.yushijinhun.com/artifact/latest/authlib-injector.jar",
    ];

    for url in urls {
        tracing::info!("Downloading authlib-injector from {}", url);
        let mut cmd = std::process::Command::new("curl.exe");
        cmd.args(["--connect-timeout", "2", "-m", "5", "-f", "-sL", url, "-o", &target_jar.to_string_lossy()]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let status = cmd.status();

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

/// Prepares CustomSkinLoader jar for Bedringh accounts.
pub fn prepare_bedringh_csl(libraries_dir: &Path) -> Option<PathBuf> {
    let csl_dir = libraries_dir.join("gg").join("bedringh").join("csl");
    let _ = std::fs::create_dir_all(&csl_dir);
    let target_jar = csl_dir.join("CustomSkinLoader_Universal-15.0.1.jar");

    if target_jar.exists() {
        if let Ok(meta) = target_jar.metadata() {
            if meta.len() > 100_000 {
                return Some(target_jar);
            }
        }
        let _ = std::fs::remove_file(&target_jar);
    }

    let urls = [
        "https://github.com/xfl03/MCCustomSkinLoader/releases/download/15.0.1/CustomSkinLoader_Universal-15.0.1.jar",
        "http://127.0.0.1:3100/downloads/CustomSkinLoader.jar",
    ];

    for url in urls {
        tracing::info!("Downloading CustomSkinLoader from {}", url);
        let mut cmd = std::process::Command::new("curl.exe");
        cmd.args(["--connect-timeout", "2", "-m", "5", "-f", "-sL", url, "-o", &target_jar.to_string_lossy()]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let status = cmd.status();

        if let Ok(st) = status {
            if st.success() && target_jar.exists() {
                if let Ok(meta) = target_jar.metadata() {
                    if meta.len() > 100_000 {
                        tracing::info!("Successfully prepared CustomSkinLoader: {} bytes", meta.len());
                        return Some(target_jar);
                    }
                }
            }
        }
        let _ = std::fs::remove_file(&target_jar);
    }

    tracing::warn!("Failed to download CustomSkinLoader from all mirrors");
    None
}

fn local_skin_entry() -> serde_json::Value {
    serde_json::json!({
        "name": "LocalSkin",
        "type": "Legacy",
        "checkPNG": false,
        "skin": "LocalSkin/skins/{USERNAME}.png",
        "model": "auto",
        "cape": "LocalSkin/capes/{USERNAME}.png",
        "elytra": "LocalSkin/elytras/{USERNAME}.png"
    })
}

fn default_csl_config() -> serde_json::Value {
    serde_json::json!({
        "version": "15.0.1",
        "buildNumber": 40,
        "enableTransparentSkin": true,
        "forceLoadAllTextures": true,
        "enableCape": true,
        "threadPoolSize": 8,
        "enableLogStdOut": true,
        "cacheExpiry": 0,
        "forceUpdateSkull": false,
        "enableLocalProfileCache": false,
        "enableCacheAutoClean": false,
        "forceDisableCache": true,
        "loadlist": [
            local_skin_entry(),
            {
                "name": "GameProfile",
                "type": "GameProfile"
            },
            {
                "name": "Mojang",
                "type": "MojangAPI",
                "apiRoot": "https://api.mojang.com/",
                "sessionRoot": "https://sessionserver.mojang.com/"
            }
        ]
    })
}

/// Synchronizes the Bedringh player's skin and cape locally to an instance.
/// If the instance uses CustomSkinLoader, writes to LocalSkin/skins and LocalSkin/capes,
/// and ensures LocalSkin is prioritized in CustomSkinLoader.json so that the skin loads
/// instantly with ZERO network delay and refreshes seamlessly on world reload.
pub fn sync_skin_to_instance(
    instance_dir: &Path,
    libraries_dir: Option<&Path>,
    username: &str,
    skin_bytes: &[u8],
    cape_bytes: Option<&[u8]>,
) {
    let mods_dir = instance_dir.join("mods");
    // If mods dir exists or it's a modloader profile, ensure CSL is installed
    if mods_dir.exists() || instance_dir.join(".fabric").exists() || instance_dir.join("config").exists() {
        let _ = std::fs::create_dir_all(&mods_dir);
        let csl_mod_path = mods_dir.join("CustomSkinLoader_Universal-15.0.1.jar");
        if !csl_mod_path.exists() {
            if let Some(libs) = libraries_dir {
                if let Some(cached_csl) = prepare_bedringh_csl(libs) {
                    let _ = std::fs::copy(&cached_csl, &csl_mod_path);
                }
            }
        }
    }

    let csl_dir = instance_dir.join("CustomSkinLoader");
    let local_skin_dir = csl_dir.join("LocalSkin");
    let skins_dir = local_skin_dir.join("skins");
    let capes_dir = local_skin_dir.join("capes");

    let _ = std::fs::create_dir_all(&skins_dir);
    let _ = std::fs::create_dir_all(&capes_dir);

    let target_skin = skins_dir.join(format!("{}.png", username));
    let _ = std::fs::write(&target_skin, skin_bytes);

    let target_cape = capes_dir.join(format!("{}.png", username));
    if let Some(cape) = cape_bytes {
        let _ = std::fs::write(&target_cape, cape);
    } else {
        let _ = std::fs::remove_file(&target_cape);
    }

    // Configure CustomSkinLoader.json to prioritize LocalSkin and disable cache completely
    let config_path = csl_dir.join("CustomSkinLoader.json");
    let mut json = if config_path.exists() {
        std::fs::read_to_string(&config_path)
            .ok()
            .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
            .unwrap_or_else(default_csl_config)
    } else {
        default_csl_config()
    };

    if let Some(loadlist) = json.get_mut("loadlist").and_then(|l| l.as_array_mut()) {
        let is_first = loadlist.first().and_then(|item| item.get("name")).and_then(|n| n.as_str()) == Some("LocalSkin");
        if !is_first {
            if let Some(pos) = loadlist.iter().position(|item| item.get("name").and_then(|n| n.as_str()) == Some("LocalSkin")) {
                loadlist.remove(pos);
            }
            loadlist.insert(0, local_skin_entry());
        }
    }

    json["forceDisableCache"] = serde_json::Value::Bool(true);
    json["enableLocalProfileCache"] = serde_json::Value::Bool(false);
    json["cacheExpiry"] = serde_json::Value::Number(0.into());
    json["enableLogStdOut"] = serde_json::Value::Bool(true);

    if let Ok(new_content) = serde_json::to_string_pretty(&json) {
        let _ = std::fs::write(&config_path, new_content);
    }
}

/// Synchronizes skin and cape across all instances in the profiles directory.
pub fn sync_skin_to_all_instances(
    profiles_dir: &Path,
    libraries_dir: Option<&Path>,
    username: &str,
    skin_bytes: &[u8],
    cape_bytes: Option<&[u8]>,
) {
    if let Ok(entries) = std::fs::read_dir(profiles_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                sync_skin_to_instance(&path, libraries_dir, username, skin_bytes, cape_bytes);
            }
        }
    }
}

pub fn clear_skin_from_instance(instance_dir: &Path, username: &str) {
    let local_skin_dir = instance_dir.join("CustomSkinLoader").join("LocalSkin");
    let target_skin = local_skin_dir.join("skins").join(format!("{}.png", username));
    let target_cape = local_skin_dir.join("capes").join(format!("{}.png", username));
    let _ = std::fs::remove_file(target_skin);
    let _ = std::fs::remove_file(target_cape);
}

static LOCAL_YGGDRASIL_PORT: OnceCell<u16> = OnceCell::const_new();

/// Starts a lightweight local Yggdrasil HTTP server on 127.0.0.1:<ephemeral_port>
/// so authlib-injector can handle offline LAN multiplayer (join/hasJoined/certificates)
/// without any external hosting server.
pub async fn ensure_local_yggdrasil_server() -> Option<u16> {
    let port = LOCAL_YGGDRASIL_PORT
        .get_or_init(|| async {
            let listener = match TcpListener::bind("127.0.0.1:0").await {
                Ok(l) => l,
                Err(e) => {
                    tracing::warn!("Failed to bind local Yggdrasil server: {}", e);
                    return 0;
                }
            };
            let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
            if port == 0 {
                return 0;
            }
            tracing::info!("Started local Bedringh Yggdrasil bridge on http://127.0.0.1:{}", port);
            tokio::spawn(async move {
                loop {
                    match listener.accept().await {
                        Ok((stream, _)) => {
                            tokio::spawn(async move {
                                let _ = handle_yggdrasil_conn(stream).await;
                            });
                        }
                        Err(e) => {
                            tracing::debug!("Local Yggdrasil accept error: {}", e);
                            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                        }
                    }
                }
            });
            port
        })
        .await;

    if *port == 0 {
        None
    } else {
        Some(*port)
    }
}

fn deterministic_offline_uuid_hex(username: &str) -> String {
    let input = format!("OfflinePlayer:{}", username);
    let digest = sha1_smol::Sha1::from(input.as_bytes()).digest().bytes();
    let mut b = [0u8; 16];
    b.copy_from_slice(&digest[..16]);
    b[6] = (b[6] & 0x0f) | 0x30;
    b[8] = (b[8] & 0x3f) | 0x80;
    uuid::Uuid::from_bytes(b).simple().to_string()
}

fn extract_query_param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let k = parts.next()?;
        let v = parts.next().unwrap_or("");
        if k == key {
            return Some(urlencoding::decode(v).map(|s| s.into_owned()).unwrap_or_else(|_| v.to_string()));
        }
    }
    None
}

async fn write_http_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: Option<&str>,
    body: &[u8],
) -> std::io::Result<()> {
    let mut header = format!(
        "HTTP/1.1 {}\r\nContent-Length: {}\r\nConnection: close\r\n",
        status,
        body.len()
    );
    if let Some(ct) = content_type {
        header.push_str(&format!("Content-Type: {}\r\n", ct));
    }
    header.push_str("\r\n");
    stream.write_all(header.as_bytes()).await?;
    if !body.is_empty() {
        stream.write_all(body).await?;
    }
    stream.flush().await
}

async fn handle_yggdrasil_conn(mut stream: TcpStream) -> std::io::Result<()> {
    let mut reader = BufReader::new(&mut stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).await? == 0 {
        return Ok(());
    }

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("/");

    let mut content_length: usize = 0;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).await?;
        if n == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((name, val)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("content-length") {
                content_length = val.trim().parse().unwrap_or(0);
            }
        }
    }

    if content_length > 0 && content_length <= 64 * 1024 {
        let mut body_buf = vec![0u8; content_length];
        let _ = reader.read_exact(&mut body_buf).await;
    }

    let (path, query) = target.split_once('?').unwrap_or((target, ""));

    match (method, path) {
        ("GET", "/") => {
            let root = serde_json::json!({
                "meta": {
                    "serverName": "Bedringh Offline",
                    "implementationName": "bedringh-local-yggdrasil",
                    "implementationVersion": "1.0.0"
                },
                "skinDomains": ["127.0.0.1", "localhost", "textures.minecraft.net", "mc-heads.net"]
            });
            let body = serde_json::to_vec(&root).unwrap_or_default();
            write_http_response(&mut stream, "200 OK", Some("application/json; charset=utf-8"), &body).await
        }
        ("POST", "/session/minecraft/join")
        | ("POST", "/sessionserver/session/minecraft/join")
        | ("POST", "/minecraftservices/player/certificates")
        | ("POST", "/player/certificates") => {
            write_http_response(&mut stream, "204 No Content", None, &[]).await
        }
        ("GET", "/session/minecraft/hasJoined")
        | ("GET", "/sessionserver/session/minecraft/hasJoined") => {
            if let Some(username) = extract_query_param(query, "username") {
                let id = deterministic_offline_uuid_hex(&username);
                let payload = serde_json::json!({
                    "id": id,
                    "name": username,
                    "properties": []
                });
                let body = serde_json::to_vec(&payload).unwrap_or_default();
                write_http_response(&mut stream, "200 OK", Some("application/json; charset=utf-8"), &body).await
            } else {
                write_http_response(&mut stream, "204 No Content", None, &[]).await
            }
        }
        _ => write_http_response(&mut stream, "204 No Content", None, &[]).await,
    }
}

