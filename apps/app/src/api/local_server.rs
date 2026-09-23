use crate::api::Result;
use async_zip::base::read::seek::ZipFileReader;
use async_zip::tokio::write::ZipFileWriter;
use async_zip::{Compression, ZipEntryBuilder};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use sysinfo::{Pid, System};
use tauri::plugin::TauriPlugin;

struct ServerProcessState {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    logs: Arc<Mutex<std::collections::VecDeque<String>>>,
    total_logs_count: Arc<std::sync::atomic::AtomicUsize>,
    is_running: Arc<AtomicBool>,
    pid: Arc<Mutex<Option<u32>>>,
    path: PathBuf,
    cached_disk_size: Arc<Mutex<(f64, Instant)>>,
}

static SERVERS: LazyLock<DashMap<String, Arc<ServerProcessState>>> = LazyLock::new(DashMap::new);
static SYSTEM: LazyLock<Mutex<System>> = LazyLock::new(|| Mutex::new(System::new_all()));
static GLOBAL_DISK_CACHE: LazyLock<Mutex<std::collections::HashMap<PathBuf, (f64, Instant)>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

pub fn init<R: tauri::Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("local-server")
        .invoke_handler(tauri::generate_handler![
            local_server_start,
            local_server_stop,
            local_server_send_command,
            local_server_get_logs,
            local_server_get_status,
            local_server_get_metrics,
            local_server_download_core,
            local_server_create_backup,
            local_server_list_backups,
            local_server_restore_backup,
            local_server_delete_backup,
            local_server_generate_scripts,
            local_server_scan_addons,
        ])
        .build()
}

fn calculate_dir_size(path: &Path) -> u64 {
    let mut total_size = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    total_size += calculate_dir_size(&entry.path());
                } else {
                    total_size += meta.len();
                }
            }
        }
    }
    total_size
}


fn find_java_executable() -> String {
    // 1. On Windows, prioritize Java 21, then Java 17 from standard vendor installations
    // (Microsoft, Eclipse Adoptium, BellSoft, Corretto, Zulu, Oracle)
    // because Minecraft 1.20.5+ requires Java 21, 1.17-1.20.4 requires Java 17,
    // and bleeding-edge versions like Java 25 break Forge/NeoForge installers and SSL handshakes.
    if cfg!(windows) {
        let standard_paths = [
            r"C:\Program Files\Microsoft",
            r"C:\Program Files\Eclipse Adoptium",
            r"C:\Program Files\BellSoft",
            r"C:\Program Files\Amazon Corretto",
            r"C:\Program Files\Zulu",
            r"C:\Program Files\Java",
        ];

        for target_ver in &["21", "17"] {
            for sp in &standard_paths {
                let p = Path::new(sp);
                if p.exists() {
                    if let Ok(entries) = std::fs::read_dir(p) {
                        for entry in entries.flatten() {
                            let path = entry.path();
                            let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                            if name.contains(target_ver) {
                                let java_exe = path.join("bin").join("java.exe");
                                if java_exe.exists() {
                                    return java_exe.to_string_lossy().to_string();
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Try JAVA_HOME
    if let Ok(jh) = std::env::var("JAVA_HOME") {
        let jh_path = PathBuf::from(&jh).join("bin").join(if cfg!(windows) { "java.exe" } else { "java" });
        if jh_path.exists() {
            return jh_path.to_string_lossy().to_string();
        }
    }

    // 3. Fallback to "java" in system PATH
    let mut test_cmd = Command::new("java");
    test_cmd.arg("-version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        test_cmd.creation_flags(0x0800_0000);
    }
    if test_cmd.output().is_ok() {
        return "java".to_string();
    }

    // 4. Any other java in standard paths
    if cfg!(windows) {
        let standard_paths = [
            r"C:\Program Files\Microsoft",
            r"C:\Program Files\Eclipse Adoptium",
            r"C:\Program Files\BellSoft",
            r"C:\Program Files\Amazon Corretto",
            r"C:\Program Files\Zulu",
            r"C:\Program Files\Java",
        ];
        for sp in &standard_paths {
            let p = Path::new(sp);
            if p.exists() {
                if let Ok(entries) = std::fs::read_dir(p) {
                    for entry in entries.flatten() {
                        let java_exe = entry.path().join("bin").join("java.exe");
                        if java_exe.exists() {
                            return java_exe.to_string_lossy().to_string();
                        }
                    }
                }
            }
        }
    }

    "java".to_string()
}

#[derive(Serialize)]
pub struct LocalServerLogsResponse {
    pub logs: Vec<String>,
    pub total: usize,
    pub running: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct LocalServerMetrics {
    pub cpu_percent: f32,
    pub ram_used_mb: u64,
    pub ram_total_mb: u64,
    pub disk_mb: f64,
    pub running: bool,
    pub pid: Option<u32>,
}

fn find_forge_args_file(dir: &Path, target_name: &str, depth: u32) -> Option<PathBuf> {
    if depth > 7 || !dir.is_dir() {
        return None;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(found) = find_forge_args_file(&path, target_name, depth + 1) {
                    return Some(found);
                }
            } else if path.file_name().map_or(false, |n| n == target_name) {
                return Some(path);
            }
        }
    }
    None
}

fn find_older_forge_jar(server_path: &Path) -> Option<PathBuf> {
    if let Ok(entries) = std::fs::read_dir(server_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with("forge-")
                        && name.ends_with(".jar")
                        && !name.contains("installer")
                        && !name.contains("shim")
                    {
                        return Some(path);
                    }
                }
            }
        }
    }
    None
}

fn get_appdata_base_dir() -> PathBuf {
    if cfg!(windows) {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("com.bedringh.app")
    } else if cfg!(target_os = "macos") {
        std::env::var("HOME")
            .map(|h| PathBuf::from(h).join("Library/Application Support/com.bedringh.app"))
            .unwrap_or_else(|_| PathBuf::from("."))
    } else {
        std::env::var("HOME")
            .map(|h| PathBuf::from(h).join(".local/share/com.bedringh.app"))
            .unwrap_or_else(|_| PathBuf::from("."))
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if !dst.exists() {
        std::fs::create_dir_all(dst)?;
    }
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dest_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            let _ = std::fs::copy(entry.path(), dest_path);
        }
    }
    Ok(())
}

fn copy_loader_assets(src_server: &Path, dst_server: &Path) {
    let src_libs = src_server.join("libraries");
    let dst_libs = dst_server.join("libraries");
    if src_libs.is_dir() {
        let _ = copy_dir_recursive(&src_libs, &dst_libs);
    }
    for file_name in &["run.bat", "run.sh", "user_jvm_args.txt", "README.txt"] {
        let src_file = src_server.join(file_name);
        let dst_file = dst_server.join(file_name);
        if src_file.exists() && !dst_file.exists() {
            let _ = std::fs::copy(&src_file, &dst_file);
        }
    }
    if let Ok(entries) = std::fs::read_dir(src_server) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with("-shim.jar") || name.ends_with("-universal.jar") {
                    let dst_file = dst_server.join(name);
                    if !dst_file.exists() {
                        let _ = std::fs::copy(entry.path(), dst_file);
                    }
                }
            }
        }
    }
}

fn is_server_neoforge(server_path: &Path) -> bool {
    let json_path = server_path.join("server.json");
    if json_path.is_file() {
        if let Ok(content) = std::fs::read_to_string(&json_path) {
            if content.contains(r#""core": "neoforge""#) || content.contains(r#""core":"neoforge""#) {
                return true;
            }
        }
    }
    server_path.join("libraries").join("net").join("neoforged").exists()
}

fn is_forge_or_neoforge_installed(server_path: &Path, target_args_name: &str, is_neoforge: bool) -> bool {
    let libs = server_path.join("libraries");
    if let Some(_af) = find_forge_args_file(&libs, target_args_name, 0) {
        if is_neoforge {
            let has_patched = find_file_recursive(&libs, "minecraft-server-patched-", ".jar", 0).is_some()
                || find_file_recursive(&libs, "server-", "-srg.jar", 0).is_some();
            return has_patched;
        } else {
            let has_forge_server = find_file_recursive(&libs, "forge-", "-server.jar", 0).is_some()
                || find_file_recursive(&libs, "forge-", "-universal.jar", 0).is_some()
                || find_file_recursive(&libs, "forge-", ".jar", 0).is_some();
            return has_forge_server;
        }
    }
    find_older_forge_jar(server_path).is_some()
}

fn save_to_loaders_cache(server_path: &Path, target_args_name: &str, is_neoforge: bool) {
    if !is_forge_or_neoforge_installed(server_path, target_args_name, is_neoforge) {
        return;
    }
    if let Some(args_file) = find_forge_args_file(&server_path.join("libraries"), target_args_name, 0) {
        if let Some(parent) = args_file.parent() {
            if let Some(folder_name) = parent.file_name().and_then(|n| n.to_str()) {
                let loader_tag = if is_neoforge { "neoforge" } else { "forge" };
                let cache_dir = get_appdata_base_dir()
                    .join("cache")
                    .join("loaders")
                    .join(format!("{}_{}", loader_tag, folder_name));
                let _ = std::fs::create_dir_all(&cache_dir);
                copy_loader_assets(server_path, &cache_dir);
                let server_json = server_path.join("server.json");
                if server_json.is_file() {
                    let _ = std::fs::copy(&server_json, cache_dir.join("server.json"));
                }
            }
        }
    }
}

fn try_clone_or_reuse_loader_runtime(
    server_path: &Path,
    target_args_name: &str,
    is_neoforge: bool,
    game_version: Option<&str>,
    core_version: Option<&str>,
) -> bool {
    let loader_tag = if is_neoforge { "neoforge" } else { "forge" };

    // 1. Check central shared loaders cache
    let cache_dir = get_appdata_base_dir().join("cache").join("loaders");
    if cache_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&cache_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    let folder_name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default();
                    if !folder_name.starts_with(loader_tag) {
                        continue;
                    }
                    if let Some(c_ver) = core_version {
                        if !c_ver.trim().is_empty() && !folder_name.contains(c_ver) {
                            continue;
                        }
                    }
                    if is_forge_or_neoforge_installed(&p, target_args_name, is_neoforge) {
                        tracing::info!("Reusing {} runtime from central cache: {:?}", loader_tag, p);
                        copy_loader_assets(&p, server_path);
                        return true;
                    }
                }
            }
        }
    }

    // 2. Check sibling servers in same servers/ directory
    if let Some(servers_dir) = server_path.parent() {
        if servers_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(servers_dir) {
                for entry in entries.flatten() {
                    let sib = entry.path();
                    if sib.is_dir() && sib != server_path {
                        let sib_is_neo = is_server_neoforge(&sib);
                        if sib_is_neo != is_neoforge {
                            continue;
                        }

                        let sib_meta: Option<ServerMetadata> = std::fs::read_to_string(sib.join("server.json"))
                            .ok()
                            .and_then(|c| serde_json::from_str(&c).ok());

                        if let (Some(g_ver), Some(sm)) = (game_version, &sib_meta) {
                            if let Some(ref sg_ver) = sm.game_version {
                                if !g_ver.trim().is_empty() && !sg_ver.trim().is_empty() && g_ver != sg_ver {
                                    continue;
                                }
                            }
                        }
                        if let (Some(c_ver), Some(sm)) = (core_version, &sib_meta) {
                            if let Some(ref sc_ver) = sm.core_version {
                                if !c_ver.trim().is_empty() && !sc_ver.trim().is_empty() && c_ver != sc_ver {
                                    continue;
                                }
                            }
                        }

                        if is_forge_or_neoforge_installed(&sib, target_args_name, is_neoforge) {
                            tracing::info!(
                                "Instant zero-install: Reusing {} runtime from sibling server: {:?}",
                                loader_tag,
                                sib
                            );
                            copy_loader_assets(&sib, server_path);
                            save_to_loaders_cache(&sib, target_args_name, is_neoforge);
                            return true;
                        }
                    }
                }
            }
        }
    }

    false
}

#[derive(Deserialize, Default)]
struct ServerMetadata {
    pub id: Option<String>,
    pub name: Option<String>,
    pub core: Option<String>,
    #[serde(rename = "gameVersion")]
    pub game_version: Option<String>,
    #[serde(rename = "coreVersion")]
    pub core_version: Option<String>,
    pub port: Option<u16>,
}

#[derive(Deserialize, Default)]
struct VersionManifestPackage {
    pub downloads: Option<VersionManifestDownloads>,
}

#[derive(Deserialize, Default)]
struct VersionManifestDownloads {
    pub server: Option<VersionManifestDownloadItem>,
    pub server_mappings: Option<VersionManifestDownloadItem>,
}

#[derive(Deserialize, Default)]
struct VersionManifestDownloadItem {
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: Option<String>,
}

fn is_log4shell_vulnerable(game_version: &str) -> bool {
    let ver = game_version.trim();
    if ver.is_empty() {
        return false;
    }
    // Vulnerable versions are Minecraft 1.7 through 1.18.1
    let vulnerable_prefixes = [
        "1.7", "1.8", "1.9", "1.10", "1.11", "1.12",
        "1.13", "1.14", "1.15", "1.16", "1.17", "1.18.1", "1.18"
    ];
    if ver == "1.18.2" {
        return false;
    }
    vulnerable_prefixes.iter().any(|prefix| ver == *prefix || ver.starts_with(&format!("{}.", prefix)))
}

fn sync_user_jvm_args(
    server_path: &Path,
    min_ram_mb: u32,
    max_ram_mb: u32,
    jvm_args: Option<&str>,
    is_vulnerable: bool,
) -> std::io::Result<()> {
    let user_jvm_path = server_path.join("user_jvm_args.txt");

    let mut content = String::new();
    content.push_str("# DO NOT EDIT THIS FILE DIRECTLY - AUTO-GENERATED BY BEDRINGH LAUNCHER\n");
    content.push_str("# TO CONFIGURE RAM AND JVM FLAGS, USE THE SERVER SETTINGS IN THE APP\n");
    content.push_str(&format!("-Xms{}M\n", min_ram_mb));
    content.push_str(&format!("-Xmx{}M\n", max_ram_mb));

    if let Some(extra) = jvm_args {
        for arg in extra.split_whitespace() {
            let trimmed = arg.trim();
            if !trimmed.is_empty() && !trimmed.starts_with("-Xmx") && !trimmed.starts_with("-Xms") {
                content.push_str(trimmed);
                content.push('\n');
            }
        }
    }

    if is_vulnerable {
        content.push_str("-Dlog4j2.formatMsgNoLookups=true\n");
    }

    std::fs::write(&user_jvm_path, content)
}

fn generate_launch_scripts(
    server_path: &Path,
    server_name: &str,
    java_bin: &str,
    min_ram_mb: u32,
    max_ram_mb: u32,
) {
    let bat_path = server_path.join("LaunchServer.bat");
    let sh_path = server_path.join("LaunchServer.sh");
    let readme_path = server_path.join("_readme.txt");

    let bat_content = format!(
r#"@echo off
setlocal enabledelayedexpansion
title Minecraft Server - {name}
REM LaunchServer.bat - Auto-generated by Bedringh Launcher (based on ATLauncher architecture)

set MAX_RAM={max}M
set MIN_RAM={min}M
set JAVAPATH="{java}"

echo ========================================================
echo Starting {name}
echo RAM: %MIN_RAM% to %MAX_RAM%
echo Java: %JAVAPATH%
echo ========================================================

REM 1. Check for Forge / NeoForge args files
if exist libraries (
    for /R libraries %%f in (win_args.txt) do (
        if exist "%%f" (
            echo Found Forge/NeoForge args file: %%f
            %JAVAPATH% @user_jvm_args.txt @"%%f" %* nogui
            goto :done
        )
    )
)

REM 2. Check for run.bat
if exist run.bat (
    echo Calling run.bat...
    call run.bat %*
    goto :done
)

REM 3. Check for server.jar
if exist server.jar (
    echo Launching server.jar...
    %JAVAPATH% -Xms%MIN_RAM% -Xmx%MAX_RAM% -jar server.jar %* nogui
    goto :done
)

echo [ERROR] No launch target (win_args.txt, run.bat, or server.jar) was found!
pause
exit /b 1

:done
pause
"#,
        name = server_name,
        java = java_bin.replace('"', ""),
        min = min_ram_mb,
        max = max_ram_mb,
    );

    let sh_content = format!(
r#"#!/usr/bin/env bash
# LaunchServer.sh - Auto-generated by Bedringh Launcher (based on ATLauncher architecture)
cd "$(dirname "$0")"

JAVAPATH="{java}"
MIN_RAM="{min}M"
MAX_RAM="{max}M"

echo "========================================================"
echo "Starting {name}"
echo "RAM: $MIN_RAM to $MAX_RAM"
echo "Java: $JAVAPATH"
echo "========================================================"

ARGS_FILE=$(find libraries -name "unix_args.txt" 2>/dev/null | head -n 1)
if [ -n "$ARGS_FILE" ]; then
    echo "Found Forge/NeoForge args file: $ARGS_FILE"
    "$JAVAPATH" @user_jvm_args.txt @"$ARGS_FILE" "$@" nogui
    exit 0
fi

if [ -f "./run.sh" ]; then
    echo "Calling run.sh..."
    chmod +x ./run.sh
    ./run.sh "$@"
    exit 0
fi

if [ -f "./server.jar" ]; then
    echo "Launching server.jar..."
    "$JAVAPATH" -Xms"$MIN_RAM" -Xmx"$MAX_RAM" -jar server.jar "$@" nogui
    exit 0
fi

echo "[ERROR] No launch target (unix_args.txt, run.sh, or server.jar) was found!"
exit 1
"#,
        name = server_name,
        java = java_bin.replace('"', ""),
        min = min_ram_mb,
        max = max_ram_mb,
    );

    let readme_content = format!(
r#"===================================================================
Minecraft Server: {name}
Created with Bedringh Launcher
===================================================================

- Чтобы запустить сервер через терминал:
  Windows: дважды кликните по LaunchServer.bat
  Linux/macOS: запустите ./LaunchServer.sh в терминале

- Настройки оперативной памяти и Java синхронизируются лаунчером
  автоматически в файл user_jvm_args.txt при каждом запуске.
"#,
        name = server_name
    );

    let _ = std::fs::write(&bat_path, bat_content);
    let _ = std::fs::write(&sh_path, sh_content);
    let _ = std::fs::write(&readme_path, readme_content);
}

async fn ensure_vanilla_server_jar(
    server_path: &Path,
    game_version: &str,
    is_neoforge: bool,
) -> Result<()> {
    if game_version.trim().is_empty() {
        return Ok(());
    }

    let mc_ver = game_version.trim();
    let server_libs_dir = server_path
        .join("libraries")
        .join("net")
        .join("minecraft")
        .join("server")
        .join(mc_ver);

    let _ = std::fs::create_dir_all(&server_libs_dir);

    let target_jar = if is_neoforge {
        server_libs_dir.join(format!("server-{}.jar", mc_ver))
    } else {
        server_libs_dir.join(format!("server-{}-bundled.jar", mc_ver))
    };
    let fallback_jar = server_libs_dir.join(format!("server-{}.jar", mc_ver));
    let mappings_file = server_libs_dir.join(format!("server-{}-mappings.txt", mc_ver));

    let mut jar_exists = (target_jar.exists()
        && std::fs::metadata(&target_jar)
            .map(|m| m.len() > 10_000_000)
            .unwrap_or(false))
        || (fallback_jar.exists()
            && std::fs::metadata(&fallback_jar)
                .map(|m| m.len() > 10_000_000)
                .unwrap_or(false));

    let mut mappings_needed = is_neoforge && (!mappings_file.exists() || std::fs::metadata(&mappings_file).map(|m| m.len() < 100_000).unwrap_or(true));

    // 0. Sibling server reuse: Check if another server already has the vanilla server jar or mappings
    if let Some(servers_dir) = server_path.parent() {
        if servers_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(servers_dir) {
                for entry in entries.flatten() {
                    let sib_p = entry.path();
                    if sib_p != server_path && sib_p.is_dir() {
                        let sib_server_dir = sib_p.join("libraries").join("net").join("minecraft").join("server").join(mc_ver);
                        if sib_server_dir.is_dir() {
                            if !jar_exists {
                                if let Ok(files) = std::fs::read_dir(&sib_server_dir) {
                                    for f in files.flatten() {
                                        let fp = f.path();
                                        if let Some(name) = fp.file_name().and_then(|n| n.to_str()) {
                                            if name.starts_with(&format!("server-{}", mc_ver)) && name.ends_with(".jar") {
                                                if let Ok(meta) = fp.metadata() {
                                                    if meta.len() > 10_000_000 {
                                                        let _ = std::fs::copy(&fp, &target_jar);
                                                        let _ = std::fs::copy(&fp, &fallback_jar);
                                                        let _ = std::fs::copy(&fp, server_libs_dir.join(format!("server-{}-bundled.jar", mc_ver)));
                                                        let _ = std::fs::copy(&fp, server_libs_dir.join(format!("server-{}-official.jar", mc_ver)));
                                                        let _ = std::fs::copy(&fp, server_libs_dir.join(format!("server-{}-extra.jar", mc_ver)));
                                                        jar_exists = true;
                                                        tracing::info!("Reused vanilla server jar from sibling: {:?}", fp);
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            if mappings_needed {
                                let sib_map = sib_server_dir.join(format!("server-{}-mappings.txt", mc_ver));
                                if sib_map.exists() && sib_map.metadata().map(|m| m.len() > 100_000).unwrap_or(false) {
                                    let _ = std::fs::copy(&sib_map, &mappings_file);
                                    mappings_needed = false;
                                    tracing::info!("Reused server mappings from sibling: {:?}", sib_map);
                                }
                            }
                        }
                    }
                    if jar_exists && !mappings_needed { break; }
                }
            }
        }
    }

    // Also extract data/*, maven/* and *-shim.jar directly from server.jar in Rust
    let installer_jar = server_path.join("server.jar");
    if installer_jar.exists() {
        if let Ok(file) = std::fs::File::open(&installer_jar) {
            if let Ok(mut archive) = zip::ZipArchive::new(file) {
                for i in 0..archive.len() {
                    if let Ok(mut entry) = archive.by_index(i) {
                        let name = entry.name().to_string();
                        if name.starts_with("data/") && !name.ends_with('/') {
                            let file_name = name.trim_start_matches("data/");
                            let out_path = server_path.join(file_name);
                            if let Some(parent) = out_path.parent() {
                                let _ = std::fs::create_dir_all(parent);
                            }
                            if let Ok(mut out_file) = std::fs::File::create(&out_path) {
                                let _ = std::io::copy(&mut entry, &mut out_file);
                            }
                        } else if name.starts_with("maven/") && !name.ends_with('/') {
                            let rel = name.trim_start_matches("maven/");
                            let out_path = server_path.join("libraries").join(rel);
                            if let Some(parent) = out_path.parent() {
                                let _ = std::fs::create_dir_all(parent);
                            }
                            if let Ok(mut out_file) = std::fs::File::create(&out_path) {
                                let _ = std::io::copy(&mut entry, &mut out_file);
                            }
                            if rel.ends_with("-shim.jar") {
                                if let Some(shim_name) = Path::new(rel).file_name() {
                                    let root_shim = server_path.join(shim_name);
                                    let _ = std::fs::copy(&out_path, &root_shim);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if !jar_exists || mappings_needed {
        tracing::info!("Pre-caching vanilla server assets for Minecraft {} (ATLauncher architecture)...", mc_ver);

        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .user_agent("Mozilla/5.0 BedringhLauncher/1.0")
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("Failed to create reqwest client for pre-caching: {}", e);
                return Ok(());
            }
        };

        // Try to fetch version manifest JSON to get direct download URLs
        let version_json_urls = vec![
            format!("https://bmclapi.bangbang93.com/version/{}/json", mc_ver),
            format!("https://bmclapi2.bangbang93.com/version/{}/json", mc_ver),
            format!("https://piston-meta.mojang.com/version/{}/json", mc_ver),
        ];

        let mut manifest_pkg: Option<VersionManifestPackage> = None;
        for vj_url in &version_json_urls {
            if let Ok(resp) = client.get(vj_url).send().await {
                if resp.status().is_success() {
                    if let Ok(pkg) = resp.json::<VersionManifestPackage>().await {
                        manifest_pkg = Some(pkg);
                        break;
                    }
                }
            }
        }

        // 1. Download vanilla server jar if missing
        if !jar_exists {
            let mut server_urls = Vec::new();
            if let Some(ref pkg) = manifest_pkg {
                if let Some(ref dl) = pkg.downloads {
                    if let Some(ref srv) = dl.server {
                        if let Some(ref u) = srv.url {
                            server_urls.push(u.replace("piston-data.mojang.com", "bmclapi.bangbang93.com"));
                            server_urls.push(u.replace("piston-data.mojang.com", "bmclapi2.bangbang93.com"));
                            server_urls.push(u.clone());
                        }
                    }
                }
            }
            server_urls.push(format!("https://bmclapi.bangbang93.com/version/{}/server", mc_ver));
            server_urls.push(format!("https://bmclapi2.bangbang93.com/version/{}/server", mc_ver));

            let mut jar_downloaded = false;
            for s_url in &server_urls {
                tracing::info!("Downloading vanilla server jar from {}", s_url);
                if let Ok(resp) = client.get(s_url).send().await {
                    if resp.status().is_success() {
                        if let Ok(bytes) = resp.bytes().await {
                            if bytes.len() > 10_000_000 {
                                let _ = std::fs::write(&target_jar, &bytes);
                                let _ = std::fs::write(&fallback_jar, &bytes);
                                let _ = std::fs::write(server_libs_dir.join(format!("server-{}-bundled.jar", mc_ver)), &bytes);
                                let _ = std::fs::write(server_libs_dir.join(format!("server-{}-official.jar", mc_ver)), &bytes);
                                let _ = std::fs::write(server_libs_dir.join(format!("server-{}-extra.jar", mc_ver)), &bytes);
                                jar_downloaded = true;
                                tracing::info!("Successfully pre-cached vanilla server jar ({} bytes)", bytes.len());
                                break;
                            }
                        }
                    }
                }
            }
            if !jar_downloaded {
                tracing::warn!("Could not pre-download vanilla server jar. Installer will attempt online download.");
            }
        }

        // 2. Download server mappings if needed (NeoForge)
        if mappings_needed {
            let mut mapping_urls = Vec::new();
            if let Some(ref pkg) = manifest_pkg {
                if let Some(ref dl) = pkg.downloads {
                    if let Some(ref maps) = dl.server_mappings {
                        if let Some(ref u) = maps.url {
                            mapping_urls.push(u.replace("piston-data.mojang.com", "bmclapi2.bangbang93.com"));
                            mapping_urls.push(u.clone());
                        }
                    }
                }
            }

            for m_url in &mapping_urls {
                tracing::info!("Downloading server mappings from {}", m_url);
                if let Ok(resp) = client.get(m_url).send().await {
                    if resp.status().is_success() {
                        if let Ok(bytes) = resp.bytes().await {
                            if bytes.len() > 100_000 {
                                let _ = std::fs::write(&mappings_file, &bytes);
                                tracing::info!("Successfully pre-cached server mappings ({} bytes)", bytes.len());
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

const SRG_CONVERT_CLASS: &[u8] = &[
    0xCA, 0xFE, 0xBA, 0xBE, 0x00, 0x00, 0x00, 0x34, 0x00, 0x2D, 0x0A, 0x00, 0x02, 0x00, 0x03, 0x07,
    0x00, 0x04, 0x0C, 0x00, 0x05, 0x00, 0x06, 0x01, 0x00, 0x10, 0x6A, 0x61, 0x76, 0x61, 0x2F, 0x6C,
    0x61, 0x6E, 0x67, 0x2F, 0x4F, 0x62, 0x6A, 0x65, 0x63, 0x74, 0x01, 0x00, 0x06, 0x3C, 0x69, 0x6E,
    0x69, 0x74, 0x3E, 0x01, 0x00, 0x03, 0x28, 0x29, 0x56, 0x07, 0x00, 0x08, 0x01, 0x00, 0x0C, 0x6A,
    0x61, 0x76, 0x61, 0x2F, 0x69, 0x6F, 0x2F, 0x46, 0x69, 0x6C, 0x65, 0x0A, 0x00, 0x07, 0x00, 0x0A,
    0x0C, 0x00, 0x05, 0x00, 0x0B, 0x01, 0x00, 0x15, 0x28, 0x4C, 0x6A, 0x61, 0x76, 0x61, 0x2F, 0x6C,
    0x61, 0x6E, 0x67, 0x2F, 0x53, 0x74, 0x72, 0x69, 0x6E, 0x67, 0x3B, 0x29, 0x56, 0x0B, 0x00, 0x0D,
    0x00, 0x0E, 0x07, 0x00, 0x0F, 0x0C, 0x00, 0x10, 0x00, 0x11, 0x01, 0x00, 0x28, 0x6E, 0x65, 0x74,
    0x2F, 0x6D, 0x69, 0x6E, 0x65, 0x63, 0x72, 0x61, 0x66, 0x74, 0x66, 0x6F, 0x72, 0x67, 0x65, 0x2F,
    0x73, 0x72, 0x67, 0x75, 0x74, 0x69, 0x6C, 0x73, 0x2F, 0x49, 0x4D, 0x61, 0x70, 0x70, 0x69, 0x6E,
    0x67, 0x46, 0x69, 0x6C, 0x65, 0x01, 0x00, 0x04, 0x6C, 0x6F, 0x61, 0x64, 0x01, 0x00, 0x3A, 0x28,
    0x4C, 0x6A, 0x61, 0x76, 0x61, 0x2F, 0x69, 0x6F, 0x2F, 0x46, 0x69, 0x6C, 0x65, 0x3B, 0x29, 0x4C,
    0x6E, 0x65, 0x74, 0x2F, 0x6D, 0x69, 0x6E, 0x65, 0x63, 0x72, 0x61, 0x66, 0x74, 0x66, 0x6F, 0x72,
    0x67, 0x65, 0x2F, 0x73, 0x72, 0x67, 0x75, 0x74, 0x69, 0x6C, 0x73, 0x2F, 0x49, 0x4D, 0x61, 0x70,
    0x70, 0x69, 0x6E, 0x67, 0x46, 0x69, 0x6C, 0x65, 0x3B, 0x0A, 0x00, 0x07, 0x00, 0x13, 0x0C, 0x00,
    0x14, 0x00, 0x15, 0x01, 0x00, 0x06, 0x74, 0x6F, 0x50, 0x61, 0x74, 0x68, 0x01, 0x00, 0x16, 0x28,
    0x29, 0x4C, 0x6A, 0x61, 0x76, 0x61, 0x2F, 0x6E, 0x69, 0x6F, 0x2F, 0x66, 0x69, 0x6C, 0x65, 0x2F,
    0x50, 0x61, 0x74, 0x68, 0x3B, 0x09, 0x00, 0x17, 0x00, 0x18, 0x07, 0x00, 0x19, 0x0C, 0x00, 0x1A,
    0x00, 0x1B, 0x01, 0x00, 0x2F, 0x6E, 0x65, 0x74, 0x2F, 0x6D, 0x69, 0x6E, 0x65, 0x63, 0x72, 0x61,
    0x66, 0x74, 0x66, 0x6F, 0x72, 0x67, 0x65, 0x2F, 0x73, 0x72, 0x67, 0x75, 0x74, 0x69, 0x6C, 0x73,
    0x2F, 0x49, 0x4D, 0x61, 0x70, 0x70, 0x69, 0x6E, 0x67, 0x46, 0x69, 0x6C, 0x65, 0x24, 0x46, 0x6F,
    0x72, 0x6D, 0x61, 0x74, 0x01, 0x00, 0x04, 0x54, 0x53, 0x52, 0x47, 0x01, 0x00, 0x31, 0x4C, 0x6E,
    0x65, 0x74, 0x2F, 0x6D, 0x69, 0x6E, 0x65, 0x63, 0x72, 0x61, 0x66, 0x74, 0x66, 0x6F, 0x72, 0x67,
    0x65, 0x2F, 0x73, 0x72, 0x67, 0x75, 0x74, 0x69, 0x6C, 0x73, 0x2F, 0x49, 0x4D, 0x61, 0x70, 0x70,
    0x69, 0x6E, 0x67, 0x46, 0x69, 0x6C, 0x65, 0x24, 0x46, 0x6F, 0x72, 0x6D, 0x61, 0x74, 0x3B, 0x0B,
    0x00, 0x0D, 0x00, 0x1D, 0x0C, 0x00, 0x1E, 0x00, 0x1F, 0x01, 0x00, 0x05, 0x77, 0x72, 0x69, 0x74,
    0x65, 0x01, 0x00, 0x49, 0x28, 0x4C, 0x6A, 0x61, 0x76, 0x61, 0x2F, 0x6E, 0x69, 0x6F, 0x2F, 0x66,
    0x69, 0x6C, 0x65, 0x2F, 0x50, 0x61, 0x74, 0x68, 0x3B, 0x4C, 0x6E, 0x65, 0x74, 0x2F, 0x6D, 0x69,
    0x6E, 0x65, 0x63, 0x72, 0x61, 0x66, 0x74, 0x66, 0x6F, 0x72, 0x67, 0x65, 0x2F, 0x73, 0x72, 0x67,
    0x75, 0x74, 0x69, 0x6C, 0x73, 0x2F, 0x49, 0x4D, 0x61, 0x70, 0x70, 0x69, 0x6E, 0x67, 0x46, 0x69,
    0x6C, 0x65, 0x24, 0x46, 0x6F, 0x72, 0x6D, 0x61, 0x74, 0x3B, 0x5A, 0x29, 0x56, 0x07, 0x00, 0x21,
    0x01, 0x00, 0x0A, 0x53, 0x72, 0x67, 0x43, 0x6F, 0x6E, 0x76, 0x65, 0x72, 0x74, 0x01, 0x00, 0x04,
    0x43, 0x6F, 0x64, 0x65, 0x01, 0x00, 0x0F, 0x4C, 0x69, 0x6E, 0x65, 0x4E, 0x75, 0x6D, 0x62, 0x65,
    0x72, 0x54, 0x61, 0x62, 0x6C, 0x65, 0x01, 0x00, 0x04, 0x6D, 0x61, 0x69, 0x6E, 0x01, 0x00, 0x16,
    0x28, 0x5B, 0x4C, 0x6A, 0x61, 0x76, 0x61, 0x2F, 0x6C, 0x61, 0x6E, 0x67, 0x2F, 0x53, 0x74, 0x72,
    0x69, 0x6E, 0x67, 0x3B, 0x29, 0x56, 0x01, 0x00, 0x0A, 0x45, 0x78, 0x63, 0x65, 0x70, 0x74, 0x69,
    0x6F, 0x6E, 0x73, 0x07, 0x00, 0x28, 0x01, 0x00, 0x13, 0x6A, 0x61, 0x76, 0x61, 0x2F, 0x6C, 0x61,
    0x6E, 0x67, 0x2F, 0x45, 0x78, 0x63, 0x65, 0x70, 0x74, 0x69, 0x6F, 0x6E, 0x01, 0x00, 0x0A, 0x53,
    0x6F, 0x75, 0x72, 0x63, 0x65, 0x46, 0x69, 0x6C, 0x65, 0x01, 0x00, 0x0F, 0x53, 0x72, 0x67, 0x43,
    0x6F, 0x6E, 0x76, 0x65, 0x72, 0x74, 0x2E, 0x6A, 0x61, 0x76, 0x61, 0x01, 0x00, 0x0C, 0x49, 0x6E,
    0x6E, 0x65, 0x72, 0x43, 0x6C, 0x61, 0x73, 0x73, 0x65, 0x73, 0x01, 0x00, 0x06, 0x46, 0x6F, 0x72,
    0x6D, 0x61, 0x74, 0x00, 0x21, 0x00, 0x20, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00,
    0x01, 0x00, 0x05, 0x00, 0x06, 0x00, 0x01, 0x00, 0x22, 0x00, 0x00, 0x00, 0x1D, 0x00, 0x01, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x05, 0x2A, 0xB7, 0x00, 0x01, 0xB1, 0x00, 0x00, 0x00, 0x01, 0x00, 0x23,
    0x00, 0x00, 0x00, 0x06, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x09, 0x00, 0x24, 0x00, 0x25,
    0x00, 0x02, 0x00, 0x22, 0x00, 0x00, 0x00, 0x3C, 0x00, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x24,
    0xB8, 0x00, 0x07, 0x59, 0x2A, 0x03, 0x32, 0xB7, 0x00, 0x09, 0xB8, 0x00, 0x0C, 0xBB, 0x00, 0x07,
    0x59, 0x2A, 0x04, 0x32, 0xB7, 0x00, 0x09, 0xB6, 0x00, 0x12, 0xB2, 0x00, 0x16, 0x03, 0xB9, 0x00,
    0x1C, 0x04, 0x00, 0xB1, 0x00, 0x00, 0x00, 0x01, 0x00, 0x23, 0x00, 0x00, 0x00, 0x06, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x26, 0x00, 0x00, 0x00, 0x04, 0x00, 0x01, 0x00, 0x27, 0x00, 0x02,
    0x00, 0x29, 0x00, 0x00, 0x00, 0x02, 0x00, 0x2A, 0x00, 0x2B, 0x00, 0x00, 0x00, 0x0A, 0x00, 0x01,
    0x00, 0x17, 0x00, 0x0D, 0x00, 0x2C, 0x40, 0x19,
];

fn find_file_recursive(dir: &Path, prefix: &str, suffix: &str, depth: u32) -> Option<PathBuf> {
    if depth > 8 || !dir.is_dir() {
        return None;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(found) = find_file_recursive(&path, prefix, suffix, depth + 1) {
                    return Some(found);
                }
            } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with(prefix) && name.ends_with(suffix) {
                    return Some(path);
                }
            }
        }
    }
    None
}

fn remove_mojmaps_processor(jar_path: &Path) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let temp_path = jar_path.with_extension("tmp_patch_jar");
    {
        let src_file = std::fs::File::open(jar_path)?;
        let mut archive = zip::ZipArchive::new(src_file)?;
        let dst_file = std::fs::File::create(&temp_path)?;
        let mut writer = zip::ZipWriter::new(dst_file);

        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            let name = file.name().to_string();

            // 1. Strip signature files (.SF, .RSA, .DSA, .EC) so Java doesn't check jar signatures
            let is_signature_file = name.starts_with("META-INF/")
                && (name.ends_with(".SF") || name.ends_with(".RSA") || name.ends_with(".DSA") || name.ends_with(".EC"));
            if is_signature_file {
                tracing::info!("Installer: Stripped signature file {:?}", name);
                continue;
            }

            // 2. Sanitize MANIFEST.MF to remove individual file digest blocks
            if name == "META-INF/MANIFEST.MF" {
                let mut content = String::new();
                let _ = std::io::Read::read_to_string(&mut file, &mut content);
                let mut main_class = "net.minecraftforge.installer.SimpleInstaller".to_string();
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("Main-Class:") {
                        if let Some(val) = trimmed.strip_prefix("Main-Class:") {
                            let val_trimmed = val.trim();
                            if !val_trimmed.is_empty() {
                                main_class = val_trimmed.to_string();
                            }
                        }
                    }
                }
                let sanitized_manifest = format!("Manifest-Version: 1.0\r\nMain-Class: {}\r\n\r\n", main_class);
                writer.start_file(
                    name,
                    zip::write::SimpleFileOptions::default()
                        .compression_method(file.compression()),
                )?;
                let _ = std::io::Write::write_all(&mut writer, sanitized_manifest.as_bytes());
                continue;
            }

            // 3. Remove DOWNLOAD_MOJMAPS processor from install_profile.json
            if name == "install_profile.json" {
                let mut content = String::new();
                std::io::Read::read_to_string(&mut file, &mut content)?;
                if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(procs) = json.get_mut("processors").and_then(|p| p.as_array_mut()) {
                        let original_len = procs.len();
                        procs.retain(|p| {
                            if let Some(args) = p.get("args").and_then(|a| a.as_array()) {
                                !args.iter().any(|arg| arg.as_str() == Some("DOWNLOAD_MOJMAPS"))
                            } else {
                                true
                            }
                        });
                        if procs.len() < original_len {
                            tracing::info!("Removed DOWNLOAD_MOJMAPS processor from installer to avoid Java SSLHandshakeException crash");
                        }
                        if let Ok(new_bytes) = serde_json::to_vec_pretty(&json) {
                            writer.start_file(
                                name,
                                zip::write::SimpleFileOptions::default()
                                    .compression_method(file.compression()),
                            )?;
                            std::io::Write::write_all(&mut writer, &new_bytes)?;
                            continue;
                        }
                    }
                }
            }

            writer.start_file(
                name,
                zip::write::SimpleFileOptions::default()
                    .compression_method(file.compression()),
            )?;
            std::io::copy(&mut file, &mut writer)?;
        }
        writer.finish()?;
    }
    std::fs::rename(&temp_path, jar_path)?;
    Ok(())
}

async fn prepare_forge_or_neoforge_installer(
    server_dir: &Path,
    game_version: &str,
    is_neoforge: bool,
) -> Result<()> {
    // 1. Pre-cache vanilla server jar and base assets
    let _ = ensure_vanilla_server_jar(server_dir, game_version, is_neoforge).await;

    let jar_path = server_dir.join("server.jar");
    if !jar_path.exists() {
        return Ok(());
    }

    let libraries_dir = server_dir.join("libraries");
    let _ = std::fs::create_dir_all(&libraries_dir);

    // 2. Read server.jar: extract bundled maven/ libraries, install_profile.json and version.json
    let mut install_profile_str: Option<String> = None;
    let mut version_json_str: Option<String> = None;

    if let Ok(src_file) = std::fs::File::open(&jar_path) {
        if let Ok(mut archive) = zip::ZipArchive::new(src_file) {
            for i in 0..archive.len() {
                if let Ok(mut entry) = archive.by_index(i) {
                    let name = entry.name().to_string();
                    if name.starts_with("maven/") {
                        if let Some(rel) = name.strip_prefix("maven/") {
                            let dest = libraries_dir.join(rel);
                            if !dest.exists() || dest.metadata().map(|m| m.len() == 0).unwrap_or(true) {
                                if let Some(parent) = dest.parent() {
                                    let _ = std::fs::create_dir_all(parent);
                                }
                                if let Ok(mut out) = std::fs::File::create(&dest) {
                                    let _ = std::io::copy(&mut entry, &mut out);
                                    tracing::info!("Extracted bundled library from installer: {:?}", rel);
                                }
                            }
                        }
                    } else if name == "install_profile.json" {
                        let mut s = String::new();
                        let _ = std::io::Read::read_to_string(&mut entry, &mut s);
                        install_profile_str = Some(s);
                    } else if name == "version.json" {
                        let mut s = String::new();
                        let _ = std::io::Read::read_to_string(&mut entry, &mut s);
                        version_json_str = Some(s);
                    }
                }
            }
        }
    }

    let ip_json: Option<serde_json::Value> = install_profile_str
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());
    let v_json: Option<serde_json::Value> = version_json_str
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());

    let mut libs_to_heal: Vec<(String, Option<String>)> = Vec::new();

    let collect_libs = |arr_opt: Option<&Vec<serde_json::Value>>, list: &mut Vec<(String, Option<String>)>| {
        if let Some(arr) = arr_opt {
            for item in arr {
                let path = item
                    .get("downloads")
                    .and_then(|d| d.get("artifact"))
                    .and_then(|a| a.get("path"))
                    .and_then(|p| p.as_str())
                    .map(|s| s.to_string());

                let direct_url = item
                    .get("downloads")
                    .and_then(|d| d.get("artifact"))
                    .and_then(|a| a.get("url"))
                    .and_then(|u| u.as_str())
                    .map(|s| s.to_string());

                if let Some(p) = path {
                    list.push((p, direct_url));
                } else if let Some(name) = item.get("name").and_then(|n| n.as_str()) {
                    if let Ok(p) = daedalus::get_path_from_artifact(name) {
                        let base_url = item.get("url").and_then(|u| u.as_str());
                        let full_url = base_url.map(|b| {
                            format!("{}/{}", b.trim_end_matches('/'), p.trim_start_matches('/'))
                        });
                        list.push((p, full_url.or(direct_url)));
                    }
                }
            }
        }
    };

    if let Some(ref ip) = ip_json {
        collect_libs(ip.get("libraries").and_then(|v| v.as_array()), &mut libs_to_heal);
        collect_libs(ip.get("versionInfo").and_then(|v| v.get("libraries")).and_then(|v| v.as_array()), &mut libs_to_heal);

        if let Some(data_obj) = ip.get("data").and_then(|d| d.as_object()) {
            for (_k, v) in data_obj {
                for side in ["server", "client"] {
                    if let Some(val_str) = v.get(side).and_then(|s| s.as_str()) {
                        let trimmed = val_str.trim();
                        if trimmed.starts_with('[') && trimmed.ends_with(']') {
                            let coord = &trimmed[1..trimmed.len() - 1];
                            if let Ok(p) = daedalus::get_path_from_artifact(coord) {
                                libs_to_heal.push((p, None));
                            }
                        }
                    }
                }
            }
        }
    }

    if let Some(ref vj) = v_json {
        collect_libs(vj.get("libraries").and_then(|v| v.as_array()), &mut libs_to_heal);
    }

    let mut seen_paths = std::collections::HashSet::new();
    libs_to_heal.retain(|(p, _)| seen_paths.insert(p.clone()));

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_default();

    // Pre-download all missing installer libraries
    for (rel_path, direct_url) in &libs_to_heal {
        let normalized = rel_path.replace('\\', "/").trim_start_matches('/').to_string();
        let target_path = libraries_dir.join(&normalized);

        if target_path.is_file() {
            if let Ok(meta) = target_path.metadata() {
                if meta.len() > 0 {
                    continue;
                }
            }
        }

        let mut healed = false;

        // Stage 1: Sibling server reuse
        if let Some(servers_root) = server_dir.parent() {
            if let Ok(entries) = std::fs::read_dir(servers_root) {
                for entry in entries.flatten() {
                    let sibling = entry.path();
                    if sibling.is_dir() && sibling != server_dir {
                        let candidate = sibling.join("libraries").join(&normalized);
                        if candidate.is_file() {
                            if let Ok(meta) = candidate.metadata() {
                                if meta.len() > 0 {
                                    if let Some(parent) = target_path.parent() {
                                        let _ = std::fs::create_dir_all(parent);
                                    }
                                    if std::fs::copy(&candidate, &target_path).is_ok() {
                                        tracing::info!("Installer: Reused library {:?} from sibling server", normalized);
                                        healed = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Stage 2: Local user caches
        if !healed {
            let mut local_candidates = Vec::new();
            if let Some(user_profile) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
                let user_path = PathBuf::from(user_profile);
                local_candidates.push(user_path.join(".m2").join("repository").join(&normalized));
                local_candidates.push(user_path.join(".minecraft").join("libraries").join(&normalized));
            }
            if let Some(app_data) = std::env::var_os("APPDATA") {
                local_candidates.push(PathBuf::from(app_data).join("com.bedringh.app").join("libraries").join(&normalized));
            }

            for cand in local_candidates {
                if cand.is_file() {
                    if let Ok(meta) = cand.metadata() {
                        if meta.len() > 0 {
                            if let Some(parent) = target_path.parent() {
                                let _ = std::fs::create_dir_all(parent);
                            }
                            if std::fs::copy(&cand, &target_path).is_ok() {
                                tracing::info!("Installer: Found library {:?} in local cache", normalized);
                                healed = true;
                                break;
                            }
                        }
                    }
                }
            }
        }

        // Stage 3: Multi-mirror download
        if !healed {
            let mut urls_to_try = Vec::new();
            if let Some(d_url) = direct_url {
                urls_to_try.push(d_url.clone());
            }
            urls_to_try.push(format!("https://bmclapi2.bangbang93.com/maven/{}", normalized));
            urls_to_try.push(format!("https://bmclapi2.bangbang93.com/libraries/{}", normalized));
            urls_to_try.push(format!("https://repo1.maven.org/maven2/{}", normalized));
            urls_to_try.push(format!("https://maven.neoforged.net/releases/{}", normalized));
            urls_to_try.push(format!("https://maven.minecraftforge.net/{}", normalized));
            urls_to_try.push(format!("https://download.fastmirror.net/maven/{}", normalized));
            urls_to_try.push(format!("https://maven.creeperhost.net/{}", normalized));
            urls_to_try.push(format!("https://libraries.minecraft.net/{}", normalized));

            for u in urls_to_try {
                if let Ok(resp) = client.get(&u).send().await {
                    if resp.status().is_success() {
                        if let Ok(bytes) = resp.bytes().await {
                            if !bytes.is_empty() {
                                if let Some(parent) = target_path.parent() {
                                    let _ = std::fs::create_dir_all(parent);
                                }
                                if std::fs::write(&target_path, &bytes).is_ok() {
                                    tracing::info!("Installer: Downloaded library {:?} ({} bytes)", normalized, bytes.len());
                                    healed = true;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        if !healed {
            tracing::warn!("Installer: Could not pre-download library {:?}", normalized);
        }
    }

    // 5. Ensure server mappings file is downloaded and complete (>= 1MB)
    let mappings_dest = libraries_dir
        .join("net")
        .join("minecraft")
        .join("server")
        .join(game_version)
        .join(format!("server-{}-mappings.txt", game_version));

    let mappings_exist = mappings_dest.is_file()
        && mappings_dest.metadata().map(|m| m.len() > 1_000_000).unwrap_or(false);

    if !mappings_exist {
        tracing::info!("Installer: Fetching Mojang server mappings for {}...", game_version);
        let manifest_urls = vec![
            format!("https://bmclapi2.bangbang93.com/version/{}/json", game_version),
            format!("https://piston-meta.mojang.com/version/{}/json", game_version),
        ];

        let mut mappings_downloaded = false;
        for m_manifest_url in manifest_urls {
            if let Ok(resp) = client.get(&m_manifest_url).send().await {
                if resp.status().is_success() {
                    if let Ok(val) = resp.json::<serde_json::Value>().await {
                        if let Some(sha1) = val
                            .get("downloads")
                            .and_then(|d| d.get("server_mappings"))
                            .and_then(|m| m.get("sha1"))
                            .and_then(|s| s.as_str())
                        {
                            let object_urls = vec![
                                format!("https://bmclapi2.bangbang93.com/v1/objects/{}/server.txt", sha1),
                                format!("https://piston-data.mojang.com/v1/objects/{}/server.txt", sha1),
                            ];
                            for obj_url in object_urls {
                                if let Ok(m_resp) = client.get(&obj_url).send().await {
                                    if m_resp.status().is_success() {
                                        if let Ok(bytes) = m_resp.bytes().await {
                                            if bytes.len() > 1_000_000 {
                                                if let Some(parent) = mappings_dest.parent() {
                                                    let _ = std::fs::create_dir_all(parent);
                                                }
                                                if std::fs::write(&mappings_dest, &bytes).is_ok() {
                                                    tracing::info!("Installer: Successfully downloaded server mappings ({} bytes)", bytes.len());
                                                    mappings_downloaded = true;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if mappings_downloaded {
                break;
            }
        }
    }

    // 6. If mappings file exists:
    let mappings_ready = mappings_dest.is_file()
        && mappings_dest.metadata().map(|m| m.len() > 100_000).unwrap_or(false);

    if mappings_ready {
        if !is_neoforge {
            let tsrg_dest = libraries_dir
                .join("net")
                .join("minecraft")
                .join("server")
                .join(game_version)
                .join(format!("server-{}-mappings.tsrg", game_version));

            let tsrg_ready = tsrg_dest.is_file()
                && tsrg_dest.metadata().map(|m| m.len() > 100_000).unwrap_or(false);

            if !tsrg_ready {
                if let Some(srgutils_jar) = find_file_recursive(&libraries_dir, "srgutils-", ".jar", 0) {
                    tracing::info!("Installer: Converting ProGuard mappings to TSRG for Forge using {:?}", srgutils_jar);
                    let temp_dir = std::env::temp_dir();
                    let convert_class = temp_dir.join("SrgConvert.class");
                    if std::fs::write(&convert_class, SRG_CONVERT_CLASS).is_ok() {
                        let java_bin = find_java_executable();
                        let cp = format!("{};{}", srgutils_jar.to_string_lossy(), temp_dir.to_string_lossy());
                        let mut convert_cmd = std::process::Command::new(&java_bin);
                        convert_cmd
                            .arg("-cp")
                            .arg(&cp)
                            .arg("SrgConvert")
                            .arg(&mappings_dest)
                            .arg(&tsrg_dest);

                        #[cfg(windows)]
                        {
                            use std::os::windows::process::CommandExt;
                            convert_cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
                        }

                        if let Ok(out) = convert_cmd.output() {
                            if out.status.success() {
                                tracing::info!("Installer: Successfully generated TSRG mappings for Forge: {:?}", tsrg_dest);
                            } else {
                                tracing::warn!("Installer: SrgConvert failed: {}", String::from_utf8_lossy(&out.stderr));
                            }
                        }
                    }
                } else {
                    tracing::warn!("Installer: srgutils jar not found in {:?}", libraries_dir);
                }
            }
        }

        // Remove DOWNLOAD_MOJMAPS processor and strip signatures from installer jar
        let _ = remove_mojmaps_processor(&jar_path);
    } else if is_neoforge {
        let _ = remove_mojmaps_processor(&jar_path);
    }

    Ok(())
}

async fn ensure_classpath_libraries(server_dir: &Path, args_file: &Path) -> Result<usize> {
    let content = match std::fs::read_to_string(args_file) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Could not read args file {:?}: {:?}", args_file, e);
            return Ok(0);
        }
    };

    let lines: Vec<&str> = content.lines().collect();
    let mut classpath_entries = Vec::new();

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();
        if line.eq_ignore_ascii_case("-classpath") || line.eq_ignore_ascii_case("-cp") {
            if i + 1 < lines.len() {
                let cp_line = lines[i + 1].trim();
                for entry in cp_line.split(';').flat_map(|s| s.split(':')) {
                    let cleaned = entry.trim().trim_matches('"').trim();
                    if !cleaned.is_empty() {
                        classpath_entries.push(cleaned.to_string());
                    }
                }
                i += 1;
            }
        } else if line.to_lowercase().starts_with("-classpath ") || line.to_lowercase().starts_with("-cp ") {
            if let Some(space_idx) = line.find(' ') {
                let rest = line[space_idx + 1..].trim();
                for entry in rest.split(';').flat_map(|s| s.split(':')) {
                    let cleaned = entry.trim().trim_matches('"').trim();
                    if !cleaned.is_empty() {
                        classpath_entries.push(cleaned.to_string());
                    }
                }
            }
        }
        i += 1;
    }

    if classpath_entries.is_empty() {
        return Ok(0);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .connect_timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_default();

    let mut healed_count = 0;

    for raw_entry in classpath_entries {
        let normalized = raw_entry.replace('\\', "/");
        if !normalized.ends_with(".jar") {
            continue;
        }

        let target_path = server_dir.join(&normalized);
        if target_path.is_file() {
            if let Ok(meta) = target_path.metadata() {
                if meta.len() > 0 {
                    continue; // Already present and non-empty
                }
            }
        }

        let mut healed = false;

        // Stage 1: Search sibling servers in servers directory
        if let Some(servers_root) = server_dir.parent() {
            if let Ok(entries) = std::fs::read_dir(servers_root) {
                for entry in entries.flatten() {
                    let sibling = entry.path();
                    if sibling.is_dir() && sibling != server_dir {
                        let candidate = sibling.join(&normalized);
                        if candidate.is_file() {
                            if let Ok(meta) = candidate.metadata() {
                                if meta.len() > 0 {
                                    if let Some(parent) = target_path.parent() {
                                        let _ = std::fs::create_dir_all(parent);
                                    }
                                    if std::fs::copy(&candidate, &target_path).is_ok() {
                                        tracing::info!("Healed library {:?} from sibling server {:?}", normalized, sibling);
                                        healed = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Stage 2: Search local user cache (.m2, .minecraft, appdata)
        if !healed {
            let rel_maven = normalized
                .strip_prefix("libraries/")
                .unwrap_or(&normalized);

            let mut local_candidates = Vec::new();
            if let Some(user_profile) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
                let user_path = PathBuf::from(user_profile);
                local_candidates.push(user_path.join(".m2").join("repository").join(rel_maven));
                local_candidates.push(user_path.join(".minecraft").join("libraries").join(rel_maven));
            }
            if let Some(app_data) = std::env::var_os("APPDATA") {
                local_candidates.push(PathBuf::from(app_data).join("com.bedringh.app").join("libraries").join(rel_maven));
            }

            for cand in local_candidates {
                if cand.is_file() {
                    if let Ok(meta) = cand.metadata() {
                        if meta.len() > 0 {
                            if let Some(parent) = target_path.parent() {
                                let _ = std::fs::create_dir_all(parent);
                            }
                            if std::fs::copy(&cand, &target_path).is_ok() {
                                tracing::info!("Healed library {:?} from local cache {:?}", normalized, cand);
                                healed = true;
                                break;
                            }
                        }
                    }
                }
            }
        }

        // Stage 3: Download from unblocked Maven mirrors
        if !healed {
            let rel_maven = normalized
                .strip_prefix("libraries/")
                .unwrap_or(&normalized);

            let mut urls_to_try = Vec::new();
            if rel_maven.starts_with("net/neoforged") {
                urls_to_try.push(format!("https://maven.neoforged.net/releases/{}", rel_maven));
                urls_to_try.push(format!("https://repo1.maven.org/maven2/{}", rel_maven));
            } else if rel_maven.starts_with("net/minecraftforge") {
                urls_to_try.push(format!("https://maven.minecraftforge.net/{}", rel_maven));
                urls_to_try.push(format!("https://maven.creeperhost.net/{}", rel_maven));
            } else if rel_maven.starts_with("com/mojang") || rel_maven.starts_with("net/minecraft") {
                urls_to_try.push(format!("https://libraries.minecraft.net/{}", rel_maven));
                urls_to_try.push(format!("https://repo1.maven.org/maven2/{}", rel_maven));
            } else {
                urls_to_try.push(format!("https://repo1.maven.org/maven2/{}", rel_maven));
                urls_to_try.push(format!("https://maven.creeperhost.net/{}", rel_maven));
                urls_to_try.push(format!("https://maven.neoforged.net/releases/{}", rel_maven));
            }

            for u in urls_to_try {
                tracing::info!("Downloading missing server library from {}", u);
                if let Ok(resp) = client.get(&u).send().await {
                    if resp.status().is_success() {
                        if let Ok(bytes) = resp.bytes().await {
                            if !bytes.is_empty() {
                                if let Some(parent) = target_path.parent() {
                                    let _ = std::fs::create_dir_all(parent);
                                }
                                if std::fs::write(&target_path, &bytes).is_ok() {
                                    tracing::info!("Successfully downloaded library {:?} ({} bytes)", normalized, bytes.len());
                                    healed = true;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        if healed {
            healed_count += 1;
        } else {
            tracing::warn!("Failed to heal missing library: {:?}", normalized);
        }
    }

    Ok(healed_count)
}

#[tauri::command]
pub async fn local_server_download_core(
    server_path: String,
    candidate_urls: Vec<String>,
) -> Result<String> {
    let s_path = PathBuf::from(&server_path);
    let target_jar = s_path.join("server.jar");
    let part_jar = s_path.join("server.jar.part");

    if !s_path.exists() {
        std::fs::create_dir_all(&s_path).map_err(|e| {
            theseus::Error::from(theseus::ErrorKind::OtherError(format!("Failed to create server directory: {}", e)))
        })?;
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .connect_timeout(Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_default();

    let mut last_err = String::new();

    for url in candidate_urls {
        tracing::info!("Native downloading server.jar for {:?} from {}", s_path, url);
        match client.get(&url).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    match resp.bytes().await {
                        Ok(bytes) => {
                            if bytes.len() > 1000 {
                                if let Err(e) = std::fs::write(&part_jar, &bytes) {
                                    last_err = format!("Failed to write server.jar.part: {}", e);
                                    continue;
                                }
                                if let Err(e) = std::fs::rename(&part_jar, &target_jar) {
                                    last_err = format!("Failed to rename server.jar.part: {}", e);
                                    continue;
                                }
                                tracing::info!("Native download complete: {} bytes from {}", bytes.len(), url);
                                return Ok(url);
                            } else {
                                last_err = format!("File too small ({} bytes)", bytes.len());
                            }
                        }
                        Err(e) => {
                            last_err = format!("Failed to read response bytes: {}", e);
                        }
                    }
                } else {
                    last_err = format!("HTTP {}", resp.status());
                }
            }
            Err(e) => {
                last_err = format!("Request error: {}", e);
            }
        }
    }

    Err(theseus::Error::from(theseus::ErrorKind::OtherError(format!(
        "Не удалось скачать server.jar через нативный загрузчик: {}",
        last_err
    ))).into())
}

fn is_forge_or_neoforge(server_path: &Path) -> bool {
    let json_path = server_path.join("server.json");
    if json_path.is_file() {
        if let Ok(content) = std::fs::read_to_string(&json_path) {
            if content.contains(r#""core": "forge""#)
                || content.contains(r#""core":"forge""#)
                || content.contains(r#""core": "neoforge""#)
                || content.contains(r#""core":"neoforge""#)
            {
                return true;
            }
        }
    }
    server_path.join("run.bat").exists()
        || server_path.join("run.sh").exists()
        || server_path.join("install_profile.json").exists()
}

#[tauri::command]
pub async fn local_server_start(
    server_id: String,
    server_path: String,
    min_ram_mb: Option<u32>,
    max_ram_mb: Option<u32>,
    jvm_args: Option<String>,
    java_path: Option<String>,
) -> Result<u32> {
    let s_path = PathBuf::from(&server_path);
    let jar_path = s_path.join("server.jar");

    // Ensure eula.txt has eula=true
    let eula_path = s_path.join("eula.txt");
    let _ = std::fs::write(&eula_path, "eula=true\n");

    // Read server metadata
    let metadata: ServerMetadata = std::fs::read_to_string(s_path.join("server.json"))
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default();

    let server_name = metadata.name.as_deref().unwrap_or(&server_id);
    let game_version = metadata.game_version.unwrap_or_default();
    let is_vulnerable = is_log4shell_vulnerable(&game_version);

    let min_ram = min_ram_mb.unwrap_or(1024);
    let max_ram = max_ram_mb.unwrap_or(4096);

    let java_bin = if let Some(custom) = java_path.filter(|p| !p.trim().is_empty()) {
        if Path::new(&custom).exists() {
            custom
        } else {
            find_java_executable()
        }
    } else {
        find_java_executable()
    };

    // Synchronize user_jvm_args.txt with user-selected RAM & JVM flags (ATLauncher architecture)
    let _ = sync_user_jvm_args(&s_path, min_ram, max_ram, jvm_args.as_deref(), is_vulnerable);

    // Generate standalone LaunchServer.bat and LaunchServer.sh scripts (ATLauncher architecture)
    generate_launch_scripts(&s_path, server_name, &java_bin, min_ram, max_ram);

    // If already running, return existing PID
    if let Some(existing) = SERVERS.get(&server_id) {
        if existing.is_running.load(Ordering::SeqCst) {
            if let Ok(ch_opt) = existing.child.lock() {
                if let Some(ref ch) = *ch_opt {
                    return Ok(ch.id());
                }
            }
        }
    }

    let target_args_name = if cfg!(windows) { "win_args.txt" } else { "unix_args.txt" };
    let is_neoforge = is_server_neoforge(&s_path);
    let is_fn = is_forge_or_neoforge(&s_path);

    let mut is_installed = if is_fn {
        is_forge_or_neoforge_installed(&s_path, target_args_name, is_neoforge)
    } else {
        jar_path.exists()
    };

    // If server is not yet installed and server.jar is missing, return error
    if !is_installed && !jar_path.exists() {
        return Err(theseus::Error::from(theseus::ErrorKind::OtherError(format!(
            "Файл server.jar не найден в папке {}",
            server_path
        ))).into());
    }

    // If this is a Forge / NeoForge server and not installed yet, attempt instant zero-install reuse from sibling or cache
    if is_fn && !is_installed {
        if try_clone_or_reuse_loader_runtime(
            &s_path,
            target_args_name,
            is_neoforge,
            Some(&game_version),
            metadata.core_version.as_deref(),
        ) {
            is_installed = is_forge_or_neoforge_installed(&s_path, target_args_name, is_neoforge);
            if is_installed {
                tracing::info!("Successfully bypassed Forge/NeoForge Java installer via runtime reuse: {:?}", s_path);
            }
        }
    }

    // If still not installed, run silent background installation
    if is_fn && !is_installed {
        tracing::info!("Auto-installing Forge/NeoForge server in headless mode: {:?}", s_path);

        // Pre-cache all libraries, mappings, and prepare installer (ATLauncher / Bedringh architecture)
        let _ = prepare_forge_or_neoforge_installer(&s_path, &game_version, is_neoforge).await;

        let mut install_cmd = Command::new(&java_bin);
        install_cmd
            .arg("-Djava.awt.headless=true")
            .arg("-Djava.net.preferIPv4Stack=true")
            .arg("-Djdk.tls.allowUnsafeRenegotiation=true")
            .arg("-Dsun.security.ssl.allowUnsafeRenegotiation=true")
            .arg("-jar")
            .arg("server.jar");

        if is_neoforge {
            install_cmd
                .arg("--install-server")
                .arg(".");
        } else {
            install_cmd
                .arg("--installServer")
                .arg(".")
                .arg("--offline");
        }

        install_cmd
            .current_dir(&s_path)
            .stdin(Stdio::null());

        let log_path = s_path.join("server.jar.log");
        if let Ok(log_file) = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&log_path)
        {
            if let Ok(err_file) = log_file.try_clone() {
                install_cmd.stdout(log_file);
                install_cmd.stderr(err_file);
            }
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            install_cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }

        if let Ok(mut install_child) = install_cmd.spawn() {
            let _ = install_child.wait();
        }

        is_installed = is_forge_or_neoforge_installed(&s_path, target_args_name, is_neoforge);

        if is_installed {
            save_to_loaders_cache(&s_path, target_args_name, is_neoforge);
        } else {
            let detail = if let Ok(log_content) = std::fs::read_to_string(&log_path) {
                let lines: Vec<&str> = log_content
                    .lines()
                    .map(|l| l.trim())
                    .filter(|l| !l.is_empty())
                    .collect();
                let count = lines.len();
                let start = if count > 6 { count - 6 } else { 0 };
                lines[start..].join("\n")
            } else {
                String::new()
            };
            let msg = if !detail.is_empty() {
                format!(
                    "Установщик Forge/NeoForge не смог завершить установку:\n{}\n\nПодробности в файле server.jar.log",
                    detail
                )
            } else {
                "Установщик Forge/NeoForge не смог загрузить серверные библиотеки. Проверьте соединение или файл server.jar.log в папке сервера.".to_string()
            };
            return Err(theseus::Error::from(theseus::ErrorKind::OtherError(msg)).into());
        }
    }

    let mut args_file = find_forge_args_file(&s_path.join("libraries"), target_args_name, 0);
    let mut older_forge_jar = find_older_forge_jar(&s_path);

    let mut cmd = Command::new(&java_bin);
    cmd.arg("-Djava.awt.headless=true")
        .arg(format!("-Xms{}M", min_ram))
        .arg(format!("-Xmx{}M", max_ram));

    if is_vulnerable {
        cmd.arg("-Dlog4j2.formatMsgNoLookups=true");
    }

    // Append extra JVM flags if provided
    if let Some(ref extra_flags) = jvm_args {
        for arg in extra_flags.split_whitespace() {
            let trimmed = arg.trim();
            if !trimmed.is_empty() {
                cmd.arg(trimmed);
            }
        }
    }

    let mut healed_libraries_count = 0;
    if let Some(ref args_path) = args_file {
        tracing::info!("Launching Forge/NeoForge server via @args file: {:?}", args_path);
        // Ensure all classpath libraries exist on disk before launching JVM!
        if let Ok(count) = ensure_classpath_libraries(&s_path, args_path).await {
            healed_libraries_count = count;
            if count > 0 {
                tracing::info!("Healed {} missing classpath libraries for {:?}", count, s_path);
            }
        }
        let user_jvm = s_path.join("user_jvm_args.txt");
        if user_jvm.exists() {
            cmd.arg("@user_jvm_args.txt");
        }
        let rel_args = args_path.strip_prefix(&s_path).unwrap_or(args_path);
        cmd.arg(format!("@{}", rel_args.to_string_lossy().replace('\\', "/")));
        cmd.arg("nogui");
    } else if let Some(ref older_jar) = older_forge_jar {
        tracing::info!("Launching older Forge server via jar: {:?}", older_jar);
        cmd.arg("-jar")
            .arg(older_jar)
            .arg("nogui");
    } else {
        if is_forge_or_neoforge(&s_path) {
            return Err(theseus::Error::from(theseus::ErrorKind::OtherError(
                "Файлы запуска Forge/NeoForge не найдены. Пожалуйста, проверьте папку сервера.".to_string()
            )).into());
        }
        cmd.arg("-jar")
            .arg("server.jar")
            .arg("nogui");
    }

    cmd.current_dir(&s_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    tracing::info!("Starting Minecraft local server with command: {:?} in {:?}", cmd, s_path);

    let mut child = cmd.spawn().map_err(|e| {
        theseus::Error::from(theseus::ErrorKind::OtherError(format!("Не удалось запустить Java процесс: {}", e)))
    })?;

    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdin = child.stdin.take();

    let logs = Arc::new(Mutex::new(std::collections::VecDeque::new()));
    let total_logs_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let is_running = Arc::new(AtomicBool::new(true));
    let child_arc = Arc::new(Mutex::new(Some(child)));
    let stdin_arc = Arc::new(Mutex::new(stdin));
    let pid_arc = Arc::new(Mutex::new(Some(pid)));

    // Initial disk size calculation
    let initial_disk_mb = (calculate_dir_size(&s_path) as f64) / (1024.0 * 1024.0);
    let cached_disk_size = Arc::new(Mutex::new((initial_disk_mb, Instant::now())));

    // Append initial log
    {
        if let Ok(mut l) = logs.lock() {
            let mut add_init_line = |line: String| {
                l.push_back(line);
                total_logs_count.fetch_add(1, Ordering::SeqCst);
            };
            add_init_line(format!("[Система] Локальный сервер запущен через Java (PID: {})", pid));
            if args_file.is_some() {
                add_init_line("[Система] Режим запуска: Forge/NeoForge (@args modular launcher)".to_string());
                if healed_libraries_count > 0 {
                    add_init_line(format!("[Система] Проверены библиотеки: восстановлено {} отсутствующих файлов", healed_libraries_count));
                }
            } else if older_forge_jar.is_some() {
                add_init_line("[Система] Режим запуска: Forge Jar".to_string());
            } else {
                add_init_line("[Система] Режим запуска: Стандартный server.jar".to_string());
            }
            add_init_line(format!("[Система] Память: Xms {}M, Xmx {}M. Java: {}", min_ram, max_ram, java_bin));
            if let Some(ref extra) = jvm_args {
                if !extra.trim().is_empty() {
                    add_init_line(format!("[Система] Дополнительные флаги JVM: {}", extra.trim()));
                }
            }
            add_init_line(format!("[Система] Рабочая папка: {}", server_path));
        }
    }

    // Stdout reader thread
    if let Some(stdout) = stdout {
        let logs_clone = logs.clone();
        let total_clone = total_logs_count.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                if let Ok(mut l) = logs_clone.lock() {
                    l.push_back(line);
                    total_clone.fetch_add(1, Ordering::SeqCst);
                    if l.len() > 3000 {
                        l.pop_front();
                    }
                }
            }
        });
    }

    // Stderr reader thread
    if let Some(stderr) = stderr {
        let logs_clone = logs.clone();
        let total_clone = total_logs_count.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                if let Ok(mut l) = logs_clone.lock() {
                    l.push_back(format!("[STDERR] {}", line));
                    total_clone.fetch_add(1, Ordering::SeqCst);
                    if l.len() > 3000 {
                        l.pop_front();
                    }
                }
            }
        });
    }

    // Waiter thread
    let child_wait = child_arc.clone();
    let is_running_wait = is_running.clone();
    let logs_wait = logs.clone();
    let total_wait = total_logs_count.clone();
    let pid_wait = pid_arc.clone();
    std::thread::spawn(move || {
        let status = {
            let mut opt = child_wait.lock().ok();
            if let Some(ref mut child_opt) = opt {
                if let Some(ref mut ch) = **child_opt {
                    ch.wait().ok()
                } else {
                    None
                }
            } else {
                None
            }
        };

        is_running_wait.store(false, Ordering::SeqCst);
        if let Ok(mut p) = pid_wait.lock() {
            *p = None;
        }
        if let Ok(mut l) = logs_wait.lock() {
            if let Some(st) = status {
                l.push_back(format!("[Система] Процесс сервера завершился с кодом: {:?}", st.code()));
            } else {
                l.push_back("[Система] Процесс сервера остановлен.".to_string());
            }
            total_wait.fetch_add(1, Ordering::SeqCst);
            if l.len() > 3000 {
                l.pop_front();
            }
        }
    });

    let state = Arc::new(ServerProcessState {
        child: child_arc,
        stdin: stdin_arc,
        logs,
        total_logs_count,
        is_running,
        pid: pid_arc,
        path: s_path,
        cached_disk_size,
    });

    SERVERS.insert(server_id, state);

    Ok(pid)
}

#[tauri::command]
pub async fn local_server_send_command(server_id: String, command: String) -> Result<()> {
    if let Some(state) = SERVERS.get(&server_id) {
        if !state.is_running.load(Ordering::SeqCst) {
            return Err(theseus::Error::from(theseus::ErrorKind::OtherError("Сервер не запущен".to_string())).into());
        }

        // Add to logs
        if let Ok(mut l) = state.logs.lock() {
            l.push_back(format!("> {}", command));
            state.total_logs_count.fetch_add(1, Ordering::SeqCst);
            if l.len() > 3000 {
                l.pop_front();
            }
        }

        // Write to stdin
        if let Ok(mut stdin_opt) = state.stdin.lock() {
            if let Some(ref mut stdin) = *stdin_opt {
                writeln!(stdin, "{}", command).map_err(|e| {
                    theseus::Error::from(theseus::ErrorKind::OtherError(format!("Ошибка записи в консоль сервера: {}", e)))
                })?;
                let _ = stdin.flush();
                return Ok(());
            }
        }
    }

    Err(theseus::Error::from(theseus::ErrorKind::OtherError("Сервер не найден или не запущен".to_string())).into())
}

#[tauri::command]
pub async fn local_server_stop(server_id: String) -> Result<()> {
    if let Some(state) = SERVERS.get(&server_id) {
        if state.is_running.load(Ordering::SeqCst) {
            if let Ok(mut l) = state.logs.lock() {
                l.push_back("[Система] Отправка команды 'stop' серверу Minecraft...".to_string());
                state.total_logs_count.fetch_add(1, Ordering::SeqCst);
                if l.len() > 3000 {
                    l.pop_front();
                }
            }

            // 1. Try graceful stop
            if let Ok(mut stdin_opt) = state.stdin.lock() {
                if let Some(ref mut stdin) = *stdin_opt {
                    let _ = writeln!(stdin, "stop");
                    let _ = stdin.flush();
                }
            }

            // 2. Wait up to 10 seconds, then kill if not exited
            let child_clone = state.child.clone();
            let is_running_clone = state.is_running.clone();
            let pid_clone = state.pid.clone();
            std::thread::spawn(move || {
                for _ in 0..20 {
                    std::thread::sleep(Duration::from_millis(500));
                    if !is_running_clone.load(Ordering::SeqCst) {
                        return;
                    }
                }

                // Force kill if still hanging
                if let Ok(mut opt) = child_clone.lock() {
                    if let Some(ref mut ch) = *opt {
                        #[cfg(windows)]
                        {
                            let pid = ch.id();
                            let mut kill_cmd = std::process::Command::new("taskkill");
                            kill_cmd.args(&["/PID", &pid.to_string(), "/T", "/F"]);
                            use std::os::windows::process::CommandExt;
                            kill_cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
                            let _ = kill_cmd.output();
                        }
                        let _ = ch.kill();
                    }
                }
                is_running_clone.store(false, Ordering::SeqCst);
                if let Ok(mut p) = pid_clone.lock() {
                    *p = None;
                }
            });
        }
        return Ok(());
    }

    Ok(())
}

#[tauri::command]
pub async fn local_server_get_logs(server_id: String, since_index: usize) -> Result<LocalServerLogsResponse> {
    if let Some(state) = SERVERS.get(&server_id) {
        let running = state.is_running.load(Ordering::SeqCst);
        let total = state.total_logs_count.load(Ordering::SeqCst);
        if let Ok(l) = state.logs.lock() {
            let buffer_len = l.len();
            let oldest_available_index = total.saturating_sub(buffer_len);
            let start_offset = if since_index <= oldest_available_index {
                0
            } else {
                since_index - oldest_available_index
            };
            let slice: Vec<String> = if start_offset < buffer_len {
                l.iter().skip(start_offset).cloned().collect()
            } else {
                Vec::new()
            };
            return Ok(LocalServerLogsResponse {
                logs: slice,
                total,
                running,
            });
        }
    }

    Ok(LocalServerLogsResponse {
        logs: Vec::new(),
        total: 0,
        running: false,
    })
}

#[tauri::command]
pub async fn local_server_get_status(server_id: String) -> Result<bool> {
    if let Some(state) = SERVERS.get(&server_id) {
        return Ok(state.is_running.load(Ordering::SeqCst));
    }
    Ok(false)
}

#[tauri::command]
pub async fn local_server_get_metrics(
    server_id: String,
    server_path: Option<String>,
) -> Result<LocalServerMetrics> {
    let mut cpu_percent = 0.0f32;
    let mut ram_used_mb = 0u64;
    let mut running = false;
    let mut pid_res = None;

    let target_path = if let Some(state) = SERVERS.get(&server_id) {
        running = state.is_running.load(Ordering::SeqCst);
        if running {
            if let Ok(p_opt) = state.pid.lock() {
                pid_res = *p_opt;
            }
        }
        Some(state.path.clone())
    } else {
        server_path.map(PathBuf::from)
    };

    let ram_total_mb = {
        let mut sys = SYSTEM.lock().unwrap();
        if let Some(pid_num) = pid_res {
            let root_pid = Pid::from_u32(pid_num);
            // Refresh only the specific server process without scanning the entire OS (refresh_all = false).
            // This completely eliminates high CPU spikes and prevents Windows Defender heuristic scans.
            sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[root_pid]), false);
            if let Some(proc) = sys.process(root_pid) {
                ram_used_mb = proc.memory() / (1024 * 1024);
                let num_cpus = sys.cpus().len().max(1) as f32;
                cpu_percent = ((proc.cpu_usage() / num_cpus) * 10.0).round() / 10.0;
            }
        } else {
            // Just refresh memory if needed
            sys.refresh_memory();
        }
        sys.total_memory() / (1024 * 1024)
    };

    // Calculate disk size with 30-second global cache to prevent CPU and disk thrashing
    let mut disk_mb = 0.0f64;
    if let Some(ref p) = target_path {
        if p.exists() {
            let mut cache = GLOBAL_DISK_CACHE.lock().unwrap();
            if let Some((cached_mb, last_time)) = cache.get(p) {
                if last_time.elapsed().as_secs() < 30 {
                    disk_mb = *cached_mb;
                }
            }
            if disk_mb == 0.0 {
                let bytes = calculate_dir_size(p);
                disk_mb = (bytes as f64) / (1024.0 * 1024.0);
                cache.insert(p.clone(), (disk_mb, Instant::now()));
            }
        }
    }

    Ok(LocalServerMetrics {
        cpu_percent,
        ram_used_mb,
        ram_total_mb,
        disk_mb,
        running,
        pid: pid_res,
    })
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LocalServerBackup {
    pub file_name: String,
    pub file_path: String,
    pub size_bytes: u64,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ScannedAddonFile {
    pub file_name: String,
    pub relative_path: String,
    pub addon_type: String,
    pub enabled: bool,
    pub size_bytes: u64,
    pub sha1: String,
}

fn get_backups_dir(server_id: &str) -> PathBuf {
    let base = if cfg!(windows) {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("com.bedringh.app")
    } else if cfg!(target_os = "macos") {
        std::env::var("HOME")
            .map(|h| PathBuf::from(h).join("Library/Application Support/com.bedringh.app"))
            .unwrap_or_else(|_| PathBuf::from("."))
    } else {
        std::env::var("HOME")
            .map(|h| PathBuf::from(h).join(".local/share/com.bedringh.app"))
            .unwrap_or_else(|_| PathBuf::from("."))
    };
    base.join("backups").join("servers").join(server_id)
}

#[tauri::command]
pub async fn local_server_create_backup(
    server_id: String,
    server_path: String,
    backup_name: Option<String>,
) -> Result<LocalServerBackup> {
    let s_path = PathBuf::from(&server_path);
    if !s_path.exists() || !s_path.is_dir() {
        return Err(theseus::Error::from(theseus::ErrorKind::OtherError(format!(
            "Папка сервера не существует: {server_path}"
        )))
        .into());
    }

    let backups_dir = get_backups_dir(&server_id);
    tokio::fs::create_dir_all(&backups_dir).await?;

    let timestamp_str = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let safe_name = backup_name
        .unwrap_or_else(|| "Server".to_string())
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    let file_name = format!("{safe_name}_{timestamp_str}.zip");
    let backup_file_path = backups_dir.join(&file_name);

    let file = tokio::fs::File::create(&backup_file_path).await?;
    let mut writer = ZipFileWriter::with_tokio(file);

    let mut dirs_to_visit = vec![s_path.clone()];
    while let Some(current_dir) = dirs_to_visit.pop() {
        let mut entries = tokio::fs::read_dir(&current_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if name == "backups" || name == "session.lock" || name.ends_with(".tmp") || name.ends_with(".download") {
                continue;
            }

            let file_type = entry.file_type().await?;
            if file_type.is_dir() {
                dirs_to_visit.push(path);
            } else if file_type.is_file() {
                if let Ok(rel) = path.strip_prefix(&s_path) {
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    if let Ok(bytes) = tokio::fs::read(&path).await {
                        let builder = ZipEntryBuilder::new(
                            rel_str.into(),
                            Compression::Deflate,
                        );
                        let _ = writer.write_entry_whole(builder, &bytes).await;
                    }
                }
            }
        }
    }

    writer.close().await.map_err(|e| {
        theseus::Error::from(theseus::ErrorKind::OtherError(format!(
            "Ошибка создания архива: {e}"
        )))
    })?;

    let meta = tokio::fs::metadata(&backup_file_path).await?;
    let created_at = chrono::Utc::now().timestamp_millis();

    Ok(LocalServerBackup {
        file_name,
        file_path: backup_file_path.to_string_lossy().to_string(),
        size_bytes: meta.len(),
        created_at,
    })
}

#[tauri::command]
pub async fn local_server_list_backups(server_id: String) -> Result<Vec<LocalServerBackup>> {
    let backups_dir = get_backups_dir(&server_id);
    if !backups_dir.exists() {
        return Ok(Vec::new());
    }

    let mut list = Vec::new();
    let mut entries = tokio::fs::read_dir(&backups_dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_file() && name.ends_with(".zip") {
            if let Ok(meta) = entry.metadata().await {
                let created_at = meta
                    .created()
                    .or_else(|_| meta.modified())
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);

                list.push(LocalServerBackup {
                    file_name: name,
                    file_path: path.to_string_lossy().to_string(),
                    size_bytes: meta.len(),
                    created_at,
                });
            }
        }
    }

    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(list)
}

#[tauri::command]
pub async fn local_server_restore_backup(
    server_id: String,
    server_path: String,
    backup_file_name: String,
) -> Result<()> {
    if let Some(state) = SERVERS.get(&server_id) {
        if state.is_running.load(Ordering::SeqCst) {
            return Err(theseus::Error::from(theseus::ErrorKind::OtherError(
                "Невозможно восстановить резервную копию: сервер сейчас запущен. Сначала остановите сервер.".to_string(),
            ))
            .into());
        }
    }

    let backups_dir = get_backups_dir(&server_id);
    let backup_path = backups_dir.join(&backup_file_name);
    if !backup_path.exists() {
        return Err(theseus::Error::from(theseus::ErrorKind::OtherError(format!(
            "Файл резервной копии не найден: {backup_file_name}"
        )))
        .into());
    }

    let s_path = PathBuf::from(&server_path);
    tokio::fs::create_dir_all(&s_path).await?;

    let file_bytes = tokio::fs::read(&backup_path).await?;
    let reader = std::io::Cursor::new(file_bytes);
    let zip_reader = ZipFileReader::with_tokio(reader)
        .await
        .map_err(|e| {
            theseus::Error::from(theseus::ErrorKind::OtherError(format!(
                "Не удалось открыть zip-архив бэкапа: {e}"
            )))
        })?;

    let entries: Vec<(usize, String)> = zip_reader
        .file()
        .entries()
        .iter()
        .enumerate()
        .filter_map(|(i, entry)| {
            let name = entry.filename().as_str().ok()?.to_string();
            if name.ends_with('/') {
                None
            } else {
                Some((i, name))
            }
        })
        .collect();

    let mut zip_reader = zip_reader;
    for (index, name) in entries {
        let safe_rel = Path::new(&name);
        if safe_rel.is_absolute() || name.contains("..") {
            continue;
        }

        let target = s_path.join(safe_rel);
        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let mut entry_reader = zip_reader.reader_with_entry(index).await.map_err(|e| {
            theseus::Error::from(theseus::ErrorKind::OtherError(format!(
                "Ошибка распаковки элемента {name}: {e}"
            )))
        })?;
        let mut entry_bytes = Vec::new();
        entry_reader.read_to_end_checked(&mut entry_bytes).await.map_err(|e| {
            theseus::Error::from(theseus::ErrorKind::OtherError(format!(
                "Ошибка чтения распакованных данных {name}: {e}"
            )))
        })?;

        tokio::fs::write(&target, &entry_bytes).await?;
    }

    Ok(())
}

#[tauri::command]
pub async fn local_server_delete_backup(
    server_id: String,
    backup_file_name: String,
) -> Result<()> {
    let backups_dir = get_backups_dir(&server_id);
    let backup_path = backups_dir.join(&backup_file_name);
    if backup_path.exists() {
        tokio::fs::remove_file(&backup_path).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn local_server_generate_scripts(
    server_path: String,
    server_name: String,
    min_ram_mb: u32,
    max_ram_mb: u32,
    jvm_args: Option<String>,
    java_path: Option<String>,
) -> Result<()> {
    let s_path = PathBuf::from(&server_path);
    if !s_path.exists() {
        tokio::fs::create_dir_all(&s_path).await?;
    }

    let java_bin = java_path.unwrap_or_else(find_java_executable);
    generate_launch_scripts(&s_path, &server_name, &java_bin, min_ram_mb, max_ram_mb);
    let _ = sync_user_jvm_args(&s_path, min_ram_mb, max_ram_mb, jvm_args.as_deref(), false);

    Ok(())
}

#[tauri::command]
pub async fn local_server_scan_addons(server_path: String) -> Result<Vec<ScannedAddonFile>> {
    let s_path = PathBuf::from(&server_path);
    if !s_path.exists() {
        return Ok(Vec::new());
    }

    let mut scanned = Vec::new();
    let scan_targets = [
        ("mods", "mod"),
        ("plugins", "plugin"),
        ("world/datapacks", "datapack"),
        ("datapacks", "datapack"),
    ];

    for (sub_dir, addon_type) in scan_targets {
        let dir = s_path.join(sub_dir);
        if !dir.exists() || !dir.is_dir() {
            continue;
        }

        if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                let file_name = entry.file_name().to_string_lossy().to_string();

                let is_jar = file_name.ends_with(".jar") || file_name.ends_with(".jar.disabled");
                let is_zip = file_name.ends_with(".zip") || file_name.ends_with(".zip.disabled");
                if (!is_jar && !is_zip) || entry.file_type().await.map(|t| !t.is_file()).unwrap_or(true) {
                    continue;
                }

                let enabled = !file_name.ends_with(".disabled");
                let meta = entry.metadata().await?;
                let size_bytes = meta.len();

                let bytes = tokio::fs::read(&path).await?;
                let sha1 = sha1_smol::Sha1::from(&bytes).digest().to_string();

                let rel_path = format!("{sub_dir}/{file_name}");
                scanned.push(ScannedAddonFile {
                    file_name,
                    relative_path: rel_path,
                    addon_type: addon_type.to_string(),
                    enabled,
                    size_bytes,
                    sha1,
                });
            }
        }
    }

    Ok(scanned)
}

