use crate::{Result, ErrorKind};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;
use tokio_util::compat::FuturesAsyncReadCompatExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BedrockAddon {
    pub uuid: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub folder_name: String,
    pub kind: String, // "resource" or "behavior"
    pub is_enabled: bool,
    pub icon_path: Option<String>,
    pub has_update: Option<bool>,
    pub latest_version: Option<String>,
    pub curseforge_mod_id: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BedrockInstalledContentRecord {
    pub project_id: String,
    pub slug: Option<String>,
    pub title: String,
    pub version_id: Option<String>,
    pub version_number: Option<String>,
    pub installed_file_name: Option<String>,
    pub source: String, // "curseforge", "modrinth", "local"
    pub curseforge_mod_id: Option<i32>,
    pub curseforge_file_id: Option<i32>,
    pub modrinth_project_id: Option<String>,
    pub modrinth_version_id: Option<String>,
    pub kind: String, // "behavior", "resource", "skin", "world"
    pub installed_folders: Vec<String>,
    pub installed_at: String,
    pub has_update: bool,
    pub latest_version_id: Option<String>,
    pub latest_version_number: Option<String>,
    pub download_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BedrockManifest {
    header: BedrockManifestHeader,
    #[serde(default)]
    modules: Option<Vec<BedrockManifestModule>>,
}

fn default_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn default_name() -> String {
    "Bedrock Pack".to_string()
}

#[derive(Debug, Deserialize)]
struct BedrockManifestHeader {
    #[serde(default = "default_uuid")]
    uuid: String,
    #[serde(default = "default_name")]
    name: String,
    description: Option<String>,
    #[serde(default)]
    version: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct BedrockManifestModule {
    #[serde(rename = "type")]
    module_type: String, // resource, data (behavior), etc.
}

fn clean_json_content(raw: &str) -> String {
    let s = raw.trim_start_matches('\u{feff}');
    let mut out = String::with_capacity(s.len());
    let mut in_string = false;
    let mut in_comment = false;
    let mut in_multiline_comment = false;
    let chars: Vec<char> = s.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let c = chars[i];
        if in_multiline_comment {
            if c == '*' && i + 1 < len && chars[i + 1] == '/' {
                in_multiline_comment = false;
                i += 2;
            } else {
                i += 1;
            }
            continue;
        }
        if in_comment {
            if c == '\n' || c == '\r' {
                in_comment = false;
                out.push(c);
            }
            i += 1;
            continue;
        }
        if in_string {
            out.push(c);
            if c == '\\' && i + 1 < len {
                i += 1;
                out.push(chars[i]);
            } else if c == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        if c == '"' {
            in_string = true;
            out.push(c);
            i += 1;
            continue;
        }
        if c == '/' && i + 1 < len {
            if chars[i + 1] == '/' {
                in_comment = true;
                i += 2;
                continue;
            } else if chars[i + 1] == '*' {
                in_multiline_comment = true;
                i += 2;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

async fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst).await?;
    let mut entries = fs::read_dir(src).await?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let ty = entry.file_type().await?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            Box::pin(copy_dir_all(&src_path, &dst_path)).await?;
        } else {
            let _ = fs::copy(&src_path, &dst_path).await?;
        }
    }
    Ok(())
}

async fn move_or_copy_dir(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    if fs::rename(src, dst).await.is_err() {
        copy_dir_all(src, dst).await?;
        let _ = fs::remove_dir_all(src).await;
    }
    Ok(())
}

fn parse_version_vec(val: &serde_json::Value) -> Vec<u32> {
    if let Some(arr) = val.as_array() {
        arr.iter().filter_map(|v| v.as_u64().map(|n| n as u32)).collect()
    } else if let Some(s) = val.as_str() {
        s.split('.').filter_map(|p| p.parse::<u32>().ok()).collect()
    } else {
        vec![1, 0, 0]
    }
}

fn sanitize_folder_name(name: &str, uuid: &str) -> String {
    let clean: String = name.chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '_' | '-' | ' ' => c,
            _ => '_',
        })
        .collect();
    let trimmed = clean.trim();
    if trimmed.is_empty() {
        uuid.to_string()
    } else {
        let short_uuid = if uuid.len() >= 8 { &uuid[..8] } else { uuid };
        format!("{}_{}", trimmed, short_uuid)
    }
}

async fn register_pack_in_worlds(com_mojang: &std::path::Path, pack_uuid: &str, version_vec: &[u32], is_resource: bool) {
    let worlds_dir = com_mojang.join("minecraftWorlds");
    if !worlds_dir.exists() {
        return;
    }

    let json_filename = if is_resource { "world_resource_packs.json" } else { "world_behavior_packs.json" };

    let mut entries = match fs::read_dir(&worlds_dir).await {
        Ok(e) => e,
        Err(_) => return,
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let world_path = entry.path();
        if !world_path.is_dir() {
            continue;
        }

        let target_json = world_path.join(json_filename);
        let mut packs: Vec<serde_json::Value> = if target_json.exists() {
            fs::read_to_string(&target_json).await
                .ok()
                .and_then(|content| {
                    let cleaned = clean_json_content(&content);
                    serde_json::from_str(&cleaned).ok()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        // Check if pack already present
        let already_present = packs.iter().any(|p| {
            p.get("pack_id").and_then(|id| id.as_str()) == Some(pack_uuid)
        });

        if !already_present {
            let ver_val = if version_vec.is_empty() { vec![1, 0, 0] } else { version_vec.to_vec() };
            let new_entry = serde_json::json!({
                "pack_id": pack_uuid,
                "version": ver_val
            });
            packs.push(new_entry);
            if let Ok(pretty) = serde_json::to_string_pretty(&packs) {
                let _ = fs::write(&target_json, pretty).await;
            }
        }
    }
}

pub async fn list_bedrock_addons(profile_path: &str) -> Result<Vec<BedrockAddon>> {
    let instance_path = crate::api::instance::get_full_path_by_path(profile_path).await?;
    let base_dir = instance_path.join("com.mojang");

    // Auto-migrate any stray pack folders sitting directly in com.mojang
    if base_dir.exists() {
        if let Ok(mut root_entries) = fs::read_dir(&base_dir).await {
            while let Ok(Some(entry)) = root_entries.next_entry().await {
                let name = entry.file_name().to_string_lossy().to_string();
                if name == "behavior_packs" || name == "resource_packs" || name == "skin_packs" || name == "minecraftWorlds" {
                    continue;
                }
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let manifest_path = path.join("manifest.json");
                if manifest_path.exists() {
                    if let Ok(content) = fs::read_to_string(&manifest_path).await {
                        let cleaned = clean_json_content(&content);
                        if let Ok(manifest) = serde_json::from_str::<BedrockManifest>(&cleaned) {
                            let mut is_skin = fs::metadata(path.join("skins.json")).await.is_ok();
                            let mut is_resource = false;
                            if let Some(modules) = &manifest.modules {
                                for m in modules {
                                    let t = m.module_type.to_lowercase();
                                    if t.contains("skin_pack") {
                                        is_skin = true;
                                    } else if t.contains("resources") || t.contains("client_data") {
                                        is_resource = true;
                                    }
                                }
                            }
                            if !is_skin && !is_resource {
                                if path.join("textures").exists() || path.join("sounds").exists() || path.join("ui").exists() || path.join("attachables").exists() {
                                    is_resource = true;
                                }
                            }
                            let kind_dir = if is_skin { "skin_packs" } else if is_resource { "resource_packs" } else { "behavior_packs" };
                            let target_base = base_dir.join(kind_dir);
                            let _ = fs::create_dir_all(&target_base).await;
                            let target_path = target_base.join(&name);
                            if !target_path.exists() {
                                let _ = move_or_copy_dir(&path, &target_path).await;
                                if !is_skin {
                                    let ver_vec = parse_version_vec(&manifest.header.version);
                                    register_pack_in_worlds(&base_dir, &manifest.header.uuid, &ver_vec, is_resource).await;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut addons = Vec::new();

    for kind in &["behavior_packs", "resource_packs", "skin_packs"] {
        let packs_dir = base_dir.join(kind);
        if !packs_dir.exists() {
            continue;
        }

        let mut entries = match fs::read_dir(&packs_dir).await {
            Ok(iter) => iter,
            Err(_) => continue,
        };

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let folder_name = entry.file_name().to_string_lossy().to_string();
            let is_enabled = !folder_name.ends_with(".disabled");

            let manifest_path = if path.join("manifest.json").exists() {
                path.join("manifest.json")
            } else {
                path.join("manifest.json.disabled")
            };
            if !manifest_path.exists() {
                continue;
            }

            if let Ok(content) = fs::read_to_string(&manifest_path).await {
                let cleaned = clean_json_content(&content);
                if let Ok(manifest) = serde_json::from_str::<BedrockManifest>(&cleaned) {
                    let kind_str = match *kind {
                        "resource_packs" => "resource".to_string(),
                        "skin_packs" => "skin".to_string(),
                        _ => "behavior".to_string(),
                    };

                    let ver_vec = parse_version_vec(&manifest.header.version);
                    let version_str = ver_vec.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(".");
                    let icon_file = path.join("pack_icon.png");
                    let icon_path = if icon_file.exists() {
                        if let Ok(bytes) = fs::read(&icon_file).await {
                            use base64::Engine;
                            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                            Some(format!("data:image/png;base64,{}", b64))
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    let curseforge_mod_id = match fs::read_to_string(path.join(".bedrin-meta.json")).await {
                        Ok(meta_str) => serde_json::from_str::<serde_json::Value>(&meta_str)
                            .ok()
                            .and_then(|v| v.get("curseforge_mod_id").and_then(|id| id.as_i64()))
                            .map(|id| id as i32),
                        Err(_) => None,
                    };

                    addons.push(BedrockAddon {
                        uuid: manifest.header.uuid,
                        name: manifest.header.name,
                        description: manifest.header.description.unwrap_or_default(),
                        version: version_str,
                        folder_name,
                        kind: kind_str,
                        is_enabled,
                        icon_path,
                        has_update: None,
                        latest_version: None,
                        curseforge_mod_id,
                    });
                }
            }
        }
    }

    let _ = sync_valid_known_packs(&base_dir).await;

    Ok(addons)
}

pub async fn sync_valid_known_packs(com_mojang: &std::path::Path) -> Result<()> {
    if !com_mojang.exists() {
        return Ok(());
    }

    let mut known_packs: Vec<serde_json::Value> = Vec::new();
    let mut global_resources: Vec<serde_json::Value> = Vec::new();

    for kind in &["behavior_packs", "resource_packs", "skin_packs"] {
        let packs_dir = com_mojang.join(kind);
        if !packs_dir.exists() {
            continue;
        }

        let mut entries = match fs::read_dir(&packs_dir).await {
            Ok(iter) => iter,
            Err(_) => continue,
        };

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let folder_name = entry.file_name().to_string_lossy().to_string();
            if folder_name.ends_with(".disabled") {
                continue;
            }

            let manifest_path = path.join("manifest.json");
            if !manifest_path.exists() {
                continue;
            }

            if let Ok(content) = fs::read_to_string(&manifest_path).await {
                let cleaned = clean_json_content(&content);

                if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&cleaned) {
                    let mut patched = false;
                    if let Some(header) = val.get_mut("header") {
                        if let Some(min_ver) = header.get("min_engine_version") {
                            if let Some(arr) = min_ver.as_array() {
                                let major = arr.get(0).and_then(|v| v.as_u64()).unwrap_or(1);
                                let minor = arr.get(1).and_then(|v| v.as_u64()).unwrap_or(0);
                                if major > 1 || (major == 1 && minor > 21) {
                                    header["min_engine_version"] = serde_json::json!([1, 20, 0]);
                                    patched = true;
                                }
                            }
                        }
                    }
                    if patched {
                        if let Ok(pretty) = serde_json::to_string_pretty(&val) {
                            let _ = fs::write(&manifest_path, pretty).await;
                        }
                    }
                }

                if let Ok(manifest) = serde_json::from_str::<BedrockManifest>(&cleaned) {
                    let rel_path = format!("{}/{}/", kind, folder_name);
                    let ver_vec = parse_version_vec(&manifest.header.version);
                    let version_str = ver_vec.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(".");

                    known_packs.push(serde_json::json!({
                        "file_system": "user",
                        "path": rel_path,
                        "uuid": manifest.header.uuid,
                        "version": version_str,
                    }));

                    if *kind != "skin_packs" {
                        let is_res = *kind == "resource_packs";
                        register_pack_in_worlds(com_mojang, &manifest.header.uuid, &ver_vec, is_res).await;
                    }

                    if *kind == "resource_packs" {
                        let ver_array = if ver_vec.is_empty() { vec![1, 0, 0] } else { ver_vec };
                        global_resources.push(serde_json::json!({
                            "pack_id": manifest.header.uuid,
                            "version": ver_array,
                        }));
                    }
                }
            }
        }
    }

    let known_json_path = com_mojang.join("valid_known_packs.json");
    if let Ok(pretty) = serde_json::to_string_pretty(&known_packs) {
        let _ = fs::write(&known_json_path, pretty).await;
    }

    let global_json_path = com_mojang.join("global_resource_packs.json");
    if let Ok(pretty) = serde_json::to_string_pretty(&global_resources) {
        let _ = fs::write(&global_json_path, pretty).await;
    }

    Ok(())
}

fn kind_to_dir(kind: &str) -> &'static str {
    match kind {
        "resource" => "resource_packs",
        "skin" => "skin_packs",
        _ => "behavior_packs",
    }
}

pub async fn set_bedrock_addon_enabled(profile_path: &str, kind: &str, folder_name: &str, enable: bool) -> Result<()> {
    let instance_path = crate::api::instance::get_full_path_by_path(profile_path).await?;
    let kind_dir = kind_to_dir(kind);
    let com_mojang = instance_path.join("com.mojang");
    let base_dir = com_mojang.join(kind_dir);

    let raw_name = folder_name.strip_suffix(".disabled").unwrap_or(folder_name);
    let enabled_folder = base_dir.join(raw_name);
    let disabled_folder = base_dir.join(format!("{}.disabled", raw_name));

    let current_path = if enabled_folder.exists() {
        enabled_folder
    } else if disabled_folder.exists() {
        disabled_folder
    } else {
        return Err(ErrorKind::OtherError(format!("Addon folder not found: {}", folder_name)).into());
    };

    let target_folder_name = if enable {
        raw_name.to_string()
    } else {
        format!("{}.disabled", raw_name)
    };
    let target_path = base_dir.join(&target_folder_name);

    if enable {
        let disabled_manifest = current_path.join("manifest.json.disabled");
        if disabled_manifest.exists() {
            let _ = fs::rename(&disabled_manifest, current_path.join("manifest.json")).await;
        }
    } else {
        let active_manifest = current_path.join("manifest.json");
        if active_manifest.exists() {
            let _ = fs::rename(&active_manifest, current_path.join("manifest.json.disabled")).await;
        }
    }

    if current_path != target_path {
        fs::rename(current_path, target_path).await?;
    }

    let _ = sync_valid_known_packs(&com_mojang).await;

    Ok(())
}

pub async fn delete_bedrock_addon(profile_path: &str, kind: &str, folder_name: &str) -> Result<()> {
    let instance_path = crate::api::instance::get_full_path_by_path(profile_path).await?;
    let kind_dir = kind_to_dir(kind);
    let com_mojang = instance_path.join("com.mojang");
    let base_dir = com_mojang.join(kind_dir);

    let target_path = base_dir.join(folder_name);
    if target_path.exists() && target_path.is_dir() {
        fs::remove_dir_all(target_path).await?;
    }

    let _ = sync_valid_known_packs(&com_mojang).await;

    Ok(())
}

const INSTALLED_CONTENT_FILENAME: &str = "bedrock_installed_content.json";

pub async fn load_installed_content_records(com_mojang: &std::path::Path) -> Vec<BedrockInstalledContentRecord> {
    let registry_path = com_mojang.join(INSTALLED_CONTENT_FILENAME);
    let mut records: Vec<BedrockInstalledContentRecord> = if registry_path.exists() {
        fs::read_to_string(&registry_path).await
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut modified = false;
    for kind in &["behavior_packs", "resource_packs", "skin_packs"] {
        let kind_dir = com_mojang.join(kind);
        if let Ok(mut entries) = fs::read_dir(&kind_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if !path.is_dir() { continue; }
                let folder_name = entry.file_name().to_string_lossy().to_string();
                let meta_path = path.join(".bedrin-meta.json");
                let mut cf_id = None;
                if meta_path.exists() {
                    if let Ok(s) = fs::read_to_string(&meta_path).await {
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&s) {
                            cf_id = val.get("curseforge_mod_id").and_then(|v| v.as_i64()).map(|i| i as i32);
                        }
                    }
                }

                let manifest_path = if path.join("manifest.json").exists() {
                    path.join("manifest.json")
                } else {
                    path.join("manifest.json.disabled")
                };

                let mut title = folder_name.clone();
                let mut version = "1.0.0".to_string();
                if manifest_path.exists() {
                    if let Ok(content) = fs::read_to_string(&manifest_path).await {
                        let cleaned = clean_json_content(&content);
                        if let Ok(manifest) = serde_json::from_str::<BedrockManifest>(&cleaned) {
                            title = manifest.header.name;
                            let ver_vec = parse_version_vec(&manifest.header.version);
                            version = ver_vec.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(".");
                        }
                    }
                }

                let clean_title = title.replace('§', "").trim().to_string();
                let key_id = cf_id.map(|id| id.to_string()).unwrap_or_else(|| folder_name.clone());

                let folder_rel = format!("{kind}/{folder_name}");
                let existing = records.iter_mut().find(|r| {
                    (cf_id.is_some() && r.curseforge_mod_id == cf_id) ||
                    r.project_id == key_id ||
                    r.installed_folders.iter().any(|f| f == &folder_rel || f.ends_with(&folder_name)) ||
                    r.title.eq_ignore_ascii_case(&clean_title)
                });

                if let Some(rec) = existing {
                    if !rec.installed_folders.contains(&folder_rel) {
                        rec.installed_folders.push(folder_rel);
                        modified = true;
                    }
                    if rec.curseforge_mod_id.is_none() && cf_id.is_some() {
                        rec.curseforge_mod_id = cf_id;
                        modified = true;
                    }
                } else {
                    records.push(BedrockInstalledContentRecord {
                        project_id: key_id,
                        slug: None,
                        title: clean_title,
                        version_id: None,
                        version_number: Some(version),
                        installed_file_name: None,
                        source: if cf_id.is_some() { "curseforge".into() } else { "local".into() },
                        curseforge_mod_id: cf_id,
                        curseforge_file_id: None,
                        modrinth_project_id: None,
                        modrinth_version_id: None,
                        kind: match *kind {
                            "resource_packs" => "resource".into(),
                            "skin_packs" => "skin".into(),
                            _ => "behavior".into(),
                        },
                        installed_folders: vec![folder_rel],
                        installed_at: chrono::Utc::now().to_rfc3339(),
                        has_update: false,
                        latest_version_id: None,
                        latest_version_number: None,
                        download_url: None,
                    });
                    modified = true;
                }
            }
        }
    }

    if modified {
        let _ = save_installed_content_records(com_mojang, &records).await;
    }

    records
}

pub async fn save_installed_content_records(com_mojang: &std::path::Path, records: &[BedrockInstalledContentRecord]) -> Result<()> {
    let registry_path = com_mojang.join(INSTALLED_CONTENT_FILENAME);
    if let Ok(pretty) = serde_json::to_string_pretty(records) {
        let _ = fs::write(&registry_path, pretty).await;
    }
    Ok(())
}

async fn extract_zip_archive(archive_file: &std::path::Path, out_dir: &std::path::Path) -> Result<()> {
    use async_zip::tokio::read::fs::ZipFileReader;
    if !archive_file.exists() {
        return Err(ErrorKind::OtherError(format!("Archive file not found: {:?}", archive_file)).into());
    }

    let reader = match ZipFileReader::new(archive_file).await {
        Ok(r) => r,
        Err(e) => return Err(ErrorKind::OtherError(format!("Failed to open zip archive: {e}")).into()),
    };

    fs::create_dir_all(out_dir).await?;

    for i in 0..reader.file().entries().len() {
        let entry = reader.file().entries().get(i).unwrap();
        if let Ok(filename) = entry.filename().as_str() {
            let clean_filename = filename.replace("..", "_");
            let out_path = out_dir.join(&clean_filename);

            if filename.ends_with('/') || filename.ends_with('\\') {
                let _ = fs::create_dir_all(&out_path).await;
                continue;
            }

            if let Some(p) = out_path.parent() {
                let _ = fs::create_dir_all(p).await;
            }

            if let Ok(entry_reader) = reader.reader_without_entry(i).await {
                if let Ok(mut out_file) = fs::File::create(&out_path).await {
                    let mut compat_reader = entry_reader.compat();
                    let _ = tokio::io::copy(&mut compat_reader, &mut out_file).await;
                }
            }
        }
    }
    Ok(())
}

pub async fn install_bedrock_addon_from_file(profile_path: &str, archive_path: &str, curseforge_mod_id: Option<i32>) -> Result<()> {
    let file_path = PathBuf::from(archive_path);
    if !file_path.exists() {
        return Err(ErrorKind::OtherError("Archive not found".into()).into());
    }

    let temp_extract_dir = std::env::temp_dir().join("bedringh").join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&temp_extract_dir).await?;

    // Initial extraction
    extract_zip_archive(&file_path, &temp_extract_dir).await?;

    // Recursively extract any nested .mcpack, .mcaddon, or .zip archives (up to 3 passes)
    let mut passes = 0;
    while passes < 3 {
        passes += 1;
        let mut nested_archives = Vec::new();
        let mut stack = vec![temp_extract_dir.clone()];
        while let Some(dir) = stack.pop() {
            if let Ok(mut entries) = fs::read_dir(&dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                        stack.push(path);
                    } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                        let ext_lower = ext.to_lowercase();
                        if ext_lower == "mcpack" || ext_lower == "mcaddon" || ext_lower == "zip" {
                            nested_archives.push(path);
                        }
                    }
                }
            }
        }

        if nested_archives.is_empty() {
            break;
        }

        for nested in nested_archives {
            let nested_stem = nested.file_stem().unwrap_or_default().to_string_lossy().to_string();
            let sub_dir = nested.parent().unwrap_or(&temp_extract_dir).join(format!("_nested_{nested_stem}_{}", uuid::Uuid::new_v4().simple()));
            let _ = fs::create_dir_all(&sub_dir).await;
            if extract_zip_archive(&nested, &sub_dir).await.is_ok() {
                let _ = fs::remove_file(&nested).await;
            }
        }
    }

    let instance_path = crate::api::instance::get_full_path_by_path(profile_path).await?;
    let com_mojang = instance_path.join("com.mojang");
    fs::create_dir_all(&com_mojang).await?;

    let mut installed_folders = Vec::new();
    let mut installed_title = String::new();
    let mut installed_version = String::new();
    let mut installed_kind = "behavior".to_string();

    // 1. Deep scan for Worlds (look for level.dat)
    let mut worlds_found = Vec::new();
    let mut stack = vec![temp_extract_dir.clone()];
    while let Some(dir) = stack.pop() {
        let level_dat = dir.join("level.dat");
        if fs::metadata(&level_dat).await.is_ok() {
            worlds_found.push(dir.clone());
            continue;
        }
        if let Ok(mut entries) = fs::read_dir(&dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                    stack.push(entry.path());
                }
            }
        }
    }

    for world_dir in worlds_found {
        let target_uuid = uuid::Uuid::new_v4().to_string();
        let out_dir = com_mojang.join("minecraftWorlds").join(&target_uuid);
        let _ = fs::create_dir_all(&out_dir).await;

        if let Ok(mut entries) = fs::read_dir(&world_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let _ = move_or_copy_dir(&entry.path(), &out_dir.join(entry.file_name())).await;
            }
        }

        let world_name = fs::read_to_string(out_dir.join("levelname.txt")).await.unwrap_or_else(|_| "Imported World".to_string());
        installed_title = world_name.trim().to_string();
        installed_kind = "world".to_string();
        let folder_rel = format!("minecraftWorlds/{target_uuid}");
        installed_folders.push(folder_rel);

        if let Some(mod_id) = curseforge_mod_id {
            let meta = serde_json::json!({
                "curseforge_mod_id": mod_id,
                "kind": "world",
                "name": installed_title,
            });
            if let Ok(meta_str) = serde_json::to_string(&meta) {
                let _ = fs::write(out_dir.join(".bedrin-meta.json"), meta_str).await;
            }
        }
    }

    // 2. Scan for pack manifests
    let mut manifests_found = Vec::new();
    let mut stack = vec![temp_extract_dir.clone()];
    while let Some(dir) = stack.pop() {
        if let Ok(mut entries) = fs::read_dir(&dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                    stack.push(entry.path());
                } else if entry.file_name() == "manifest.json" {
                    manifests_found.push(dir.clone());
                }
            }
        }
    }

    for pack_dir in manifests_found {
        let manifest_content = fs::read_to_string(pack_dir.join("manifest.json")).await.unwrap_or_default();
        let cleaned = clean_json_content(&manifest_content);
        if let Ok(manifest) = serde_json::from_str::<BedrockManifest>(&cleaned) {
            let mut is_skin = fs::metadata(pack_dir.join("skins.json")).await.is_ok();
            let mut is_resource = false;
            if let Some(modules) = &manifest.modules {
                for m in modules {
                    let t = m.module_type.to_lowercase();
                    if t.contains("skin_pack") {
                        is_skin = true;
                    } else if t.contains("resources") || t.contains("client_data") {
                        is_resource = true;
                    }
                }
            }
            if !is_skin && !is_resource {
                if pack_dir.join("textures").exists() || pack_dir.join("sounds").exists() || pack_dir.join("ui").exists() || pack_dir.join("attachables").exists() {
                    is_resource = true;
                }
            }

            let kind_dir = if is_skin { "skin_packs" } else if is_resource { "resource_packs" } else { "behavior_packs" };
            let target_base = com_mojang.join(kind_dir);
            let _ = fs::create_dir_all(&target_base).await;

            let safe_name = sanitize_folder_name(&manifest.header.name, &manifest.header.uuid);
            let target_path = target_base.join(&safe_name);
            if target_path.exists() {
                let _ = fs::remove_dir_all(&target_path).await;
            }

            let _ = move_or_copy_dir(&pack_dir, &target_path).await;

            let ver_vec = parse_version_vec(&manifest.header.version);
            let ver_str = ver_vec.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(".");

            if installed_title.is_empty() {
                installed_title = manifest.header.name.clone();
            }
            if installed_version.is_empty() {
                installed_version = ver_str.clone();
            }
            installed_kind = if is_skin { "skin".into() } else if is_resource { "resource".into() } else { "behavior".into() };

            let folder_rel = format!("{kind_dir}/{safe_name}");
            installed_folders.push(folder_rel);

            if let Some(mod_id) = curseforge_mod_id {
                let meta = serde_json::json!({
                    "curseforge_mod_id": mod_id,
                    "kind": kind_dir,
                    "name": manifest.header.name,
                    "version": ver_str,
                    "uuid": manifest.header.uuid,
                });
                if let Ok(meta_str) = serde_json::to_string(&meta) {
                    let _ = fs::write(target_path.join(".bedrin-meta.json"), meta_str).await;
                }
            }

            if !is_skin {
                register_pack_in_worlds(&com_mojang, &manifest.header.uuid, &ver_vec, is_resource).await;
            }
        }
    }

    let _ = fs::remove_dir_all(&temp_extract_dir).await;

    if installed_folders.is_empty() {
        return Err(ErrorKind::OtherError(
            "No valid Bedrock resource pack, behavior pack, skin pack, or world found in the downloaded archive.".to_string(),
        ).into());
    }

    // Register in persistent content registry
    let mut records = load_installed_content_records(&com_mojang).await;
    let key_id = curseforge_mod_id.map(|id| id.to_string()).unwrap_or_else(|| {
        installed_folders.first().cloned().unwrap_or_default()
    });

    let existing = records.iter_mut().find(|r| {
        (curseforge_mod_id.is_some() && r.curseforge_mod_id == curseforge_mod_id) ||
        r.project_id == key_id
    });

    if let Some(rec) = existing {
        rec.installed_folders = installed_folders;
        if !installed_version.is_empty() {
            rec.version_number = Some(installed_version);
        }
        rec.has_update = false;
        rec.installed_at = chrono::Utc::now().to_rfc3339();
    } else {
        records.push(BedrockInstalledContentRecord {
            project_id: key_id,
            slug: None,
            title: installed_title,
            version_id: None,
            version_number: if installed_version.is_empty() { None } else { Some(installed_version) },
            installed_file_name: file_path.file_name().map(|n| n.to_string_lossy().to_string()),
            source: if curseforge_mod_id.is_some() { "curseforge".into() } else { "local".into() },
            curseforge_mod_id,
            curseforge_file_id: None,
            modrinth_project_id: None,
            modrinth_version_id: None,
            kind: installed_kind,
            installed_folders,
            installed_at: chrono::Utc::now().to_rfc3339(),
            has_update: false,
            latest_version_id: None,
            latest_version_number: None,
            download_url: None,
        });
    }

    let _ = save_installed_content_records(&com_mojang, &records).await;
    let _ = sync_valid_known_packs(&com_mojang).await;

    Ok(())
}

pub async fn check_bedrock_addon_updates(profile_path: &str) -> Result<Vec<BedrockAddon>> {
    let instance_path = crate::api::instance::get_full_path_by_path(profile_path).await?;
    let com_mojang = instance_path.join("com.mojang");
    let mut records = load_installed_content_records(&com_mojang).await;
    let mut addons = list_bedrock_addons(profile_path).await?;

    for rec in &mut records {
        if let Some(mod_id) = rec.curseforge_mod_id {
            if let Ok(files) = crate::api::bedrock_curseforge::get_addon_files(mod_id).await {
                if let Some(latest) = files.first() {
                    let remote_ver = latest.display_name.trim();
                    let current_ver = rec.version_number.as_deref().unwrap_or("").trim();
                    let current_fid = rec.curseforge_file_id;

                    let has_up = if let Some(cfid) = current_fid {
                        latest.id != cfid
                    } else if !current_ver.is_empty() {
                        remote_ver != current_ver
                    } else {
                        false
                    };

                    rec.has_update = has_up;
                    rec.latest_version_id = Some(latest.id.to_string());
                    rec.latest_version_number = Some(remote_ver.to_string());
                }
            }
        }
    }

    let _ = save_installed_content_records(&com_mojang, &records).await;

    for addon in &mut addons {
        if let Some(rec) = records.iter().find(|r| {
            (addon.curseforge_mod_id.is_some() && r.curseforge_mod_id == addon.curseforge_mod_id) ||
            r.installed_folders.iter().any(|f| f.ends_with(&addon.folder_name)) ||
            r.title.eq_ignore_ascii_case(&addon.name)
        }) {
            addon.has_update = Some(rec.has_update);
            addon.latest_version = rec.latest_version_number.clone();
        }
    }

    Ok(addons)
}

pub async fn update_bedrock_addon(
    profile_path: &str,
    project_id: &str,
    target_file_id: Option<i32>,
) -> Result<()> {
    let instance_path = crate::api::instance::get_full_path_by_path(profile_path).await?;
    let com_mojang = instance_path.join("com.mojang");
    let records = load_installed_content_records(&com_mojang).await;

    let rec = records.iter().find(|r| {
        r.project_id == project_id ||
        r.curseforge_mod_id.map(|id| id.to_string()).as_deref() == Some(project_id) ||
        r.installed_folders.iter().any(|f| f.contains(project_id))
    }).cloned().ok_or_else(|| ErrorKind::InputError(format!("Project {project_id} not found in installed Bedrock content")))?;

    let mod_id = rec.curseforge_mod_id.ok_or_else(|| {
        ErrorKind::OtherError(format!("Project {project_id} does not have a CurseForge mod ID to update"))
    })?;

    let files = crate::api::bedrock_curseforge::get_addon_files(mod_id).await?;
    if files.is_empty() {
        return Err(ErrorKind::OtherError(format!("No update files found for mod {mod_id}")).into());
    }

    let target_file = if let Some(fid) = target_file_id {
        files.iter().find(|f| f.id == fid).unwrap_or(&files[0])
    } else {
        &files[0]
    };

    let download_url = if let Some(u) = &target_file.download_url {
        u.clone()
    } else {
        crate::api::bedrock_curseforge::resolve_file_download_url(mod_id, target_file.id, &target_file.file_name).await
    };

    let downloaded_file = crate::api::bedrock_curseforge::download_addon(&download_url).await?;

    // Remove old folders
    for folder_rel in &rec.installed_folders {
        let p = com_mojang.join(folder_rel);
        if p.exists() {
            let _ = fs::remove_dir_all(p).await;
        }
    }

    let install_res = install_bedrock_addon_from_file(profile_path, &downloaded_file, Some(mod_id)).await;
    let _ = fs::remove_file(&downloaded_file).await;
    install_res?;

    let mut updated_records = load_installed_content_records(&com_mojang).await;
    if let Some(r) = updated_records.iter_mut().find(|r| r.curseforge_mod_id == Some(mod_id)) {
        r.version_number = Some(target_file.display_name.clone());
        r.curseforge_file_id = Some(target_file.id);
        r.has_update = false;
    }
    let _ = save_installed_content_records(&com_mojang, &updated_records).await;

    Ok(())
}

pub async fn get_bedrock_installed_content(profile_path: &str) -> Result<Vec<BedrockInstalledContentRecord>> {
    let instance_path = crate::api::instance::get_full_path_by_path(profile_path).await?;
    let com_mojang = instance_path.join("com.mojang");
    Ok(load_installed_content_records(&com_mojang).await)
}

pub async fn get_bedrock_installed_ids(profile_path: &str) -> Result<Vec<String>> {
    let instance_path = match crate::api::instance::get_full_path_by_path(profile_path).await {
        Ok(p) => p,
        Err(_) => return Ok(Vec::new()),
    };
    let com_mojang = instance_path.join("com.mojang");
    if !com_mojang.exists() {
        return Ok(Vec::new());
    }
    let records = load_installed_content_records(&com_mojang).await;
    let mut ids = std::collections::HashSet::new();
    for r in records {
        ids.insert(r.project_id.clone());
        if let Some(cf_id) = r.curseforge_mod_id {
            ids.insert(cf_id.to_string());
            ids.insert(format!("curseforge-{cf_id}"));
            ids.insert(format!("curseforge:{cf_id}"));
        }
        if let Some(slug) = &r.slug {
            ids.insert(slug.clone());
            ids.insert(slug.to_lowercase());
        }
        let clean_t = r.title.replace('§', "").trim().to_lowercase();
        if !clean_t.is_empty() {
            ids.insert(clean_t);
        }
    }
    Ok(ids.into_iter().collect())
}

