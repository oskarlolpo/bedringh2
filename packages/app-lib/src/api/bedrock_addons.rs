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
    let instance_path = crate::api::profile::get_full_path(profile_path).await?;
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

            let manifest_path = path.join("manifest.json");
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
                        Some(icon_file.to_string_lossy().to_string())
                    } else {
                        None
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
                    });
                }
            }
        }
    }

    Ok(addons)
}

fn kind_to_dir(kind: &str) -> &'static str {
    match kind {
        "resource" => "resource_packs",
        "skin" => "skin_packs",
        _ => "behavior_packs",
    }
}

pub async fn set_bedrock_addon_enabled(profile_path: &str, kind: &str, folder_name: &str, enable: bool) -> Result<()> {
    let instance_path = crate::api::profile::get_full_path(profile_path).await?;
    let kind_dir = kind_to_dir(kind);
    let base_dir = instance_path.join("com.mojang").join(kind_dir);

    let current_path = base_dir.join(folder_name);
    if !current_path.exists() {
        return Err(ErrorKind::OtherError(format!("Addon folder not found: {}", folder_name)).into());
    }

    let is_currently_enabled = !folder_name.ends_with(".disabled");

    if is_currently_enabled == enable {
        return Ok(());
    }

    let new_folder_name = if enable {
        folder_name.strip_suffix(".disabled").unwrap_or(folder_name).to_string()
    } else {
        format!("{}.disabled", folder_name)
    };

    let new_path = base_dir.join(&new_folder_name);
    fs::rename(current_path, new_path).await?;

    Ok(())
}

pub async fn delete_bedrock_addon(profile_path: &str, kind: &str, folder_name: &str) -> Result<()> {
    let instance_path = crate::api::profile::get_full_path(profile_path).await?;
    let kind_dir = kind_to_dir(kind);
    let base_dir = instance_path.join("com.mojang").join(kind_dir);

    let target_path = base_dir.join(folder_name);
    if target_path.exists() && target_path.is_dir() {
        fs::remove_dir_all(target_path).await?;
    }

    Ok(())
}

pub async fn install_bedrock_addon_from_file(profile_path: &str, archive_path: &str) -> Result<()> {
    // We will use async_zip to extract the package.
    use async_zip::tokio::read::fs::ZipFileReader;
    let file_path = PathBuf::from(archive_path);
    if !file_path.exists() {
        return Err(ErrorKind::OtherError("Archive not found".into()).into());
    }

    let reader = match ZipFileReader::new(&file_path).await {
        Ok(r) => r,
        Err(_) => return Err(ErrorKind::OtherError("Failed to open zip archive".into()).into()),
    };

    let temp_extract_dir = std::env::temp_dir().join("bedringh").join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&temp_extract_dir).await?;

    for i in 0..reader.file().entries().len() {
        let entry = reader.file().entries().get(i).unwrap();
        if let Ok(filename) = entry.filename().as_str() {
            let out_path = temp_extract_dir.join(filename);

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

    let instance_path = crate::api::profile::get_full_path(profile_path).await?;
    let com_mojang = instance_path.join("com.mojang");

    // Figure out the "effective root" of the extracted archive - some archives
    // (especially world/map downloads) wrap everything in a single top-level folder.
    let mut effective_root = temp_extract_dir.clone();
    if let Ok(mut root_entries) = fs::read_dir(&temp_extract_dir).await {
        let mut items = Vec::new();
        while let Ok(Some(e)) = root_entries.next_entry().await {
            items.push(e.path());
        }
        if items.len() == 1 && items[0].is_dir() {
            effective_root = items[0].clone();
        }
    }

    // A full world/map (e.g. a CurseForge "Maps" download) has a level.dat at its root
    // and must be imported into minecraftWorlds, not treated as an installable pack.
    if fs::metadata(effective_root.join("level.dat")).await.is_ok() {
        // Verify this is actually a loadable save (has a non-empty LevelDB db/ folder)
        // before we accept it - otherwise the launcher would show a "world" that
        // Minecraft itself silently refuses to load, with no visible error anywhere.
        let db_dir = effective_root.join("db");
        let mut has_db_contents = false;
        if let Ok(mut db_entries) = fs::read_dir(&db_dir).await {
            if let Ok(Some(_)) = db_entries.next_entry().await {
                has_db_contents = true;
            }
        }
        if !has_db_contents {
            let _ = fs::remove_dir_all(&temp_extract_dir).await;
            return Err(ErrorKind::OtherError(
                "This download looks like a world/map but its 'db' save-data folder is missing or empty. \
                 The file is likely incomplete, corrupted, or not a real world export - it will not be \
                 loadable in Minecraft even though it would otherwise appear installed."
                    .to_string(),
            )
            .into());
        }

        let target_uuid = uuid::Uuid::new_v4().to_string();
        let out_dir = com_mojang.join("minecraftWorlds").join(&target_uuid);
        let _ = fs::create_dir_all(&out_dir).await;

        let mut entries = fs::read_dir(&effective_root).await?;
        while let Ok(Some(entry)) = entries.next_entry().await {
            let _ = move_or_copy_dir(&entry.path(), &out_dir.join(entry.file_name())).await;
        }

        let _ = fs::remove_dir_all(&temp_extract_dir).await;
        return Ok(());
    }

    // Now scan temp_extract_dir for manifest.json.
    // It can be at root or inside a folder.
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

            // Move pack_dir to target_path safely
            let _ = move_or_copy_dir(&pack_dir, &target_path).await;

            // Register pack in existing worlds (skin packs aren't referenced per-world)
            if !is_skin {
                let ver_vec = parse_version_vec(&manifest.header.version);
                register_pack_in_worlds(&com_mojang, &manifest.header.uuid, &ver_vec, is_resource).await;
            }
        }
    }

    let _ = fs::remove_dir_all(&temp_extract_dir).await;

    Ok(())
}

pub async fn check_bedrock_addon_updates(profile_path: &str) -> Result<Vec<BedrockAddon>> {
    let mut addons = list_bedrock_addons(profile_path).await?;

    for addon in &mut addons {
        if let Ok(search_results) = crate::api::bedrock_curseforge::search_addons(
            &addon.name,
            None,
            Some(4984),
            None,
            None,
            None,
            Some(0),
            Some(1),
        ).await {
            if let Some(match_mod) = search_results.data.into_iter().next() {
                if let Ok(files) = crate::api::bedrock_curseforge::get_addon_files(match_mod.id).await {
                    if let Some(latest_file) = files.first() {
                        let remote_ver = &latest_file.display_name;
                        if remote_ver != &addon.version {
                            addon.has_update = Some(true);
                            addon.latest_version = Some(remote_ver.clone());
                        } else {
                            addon.has_update = Some(false);
                            addon.latest_version = Some(remote_ver.clone());
                        }
                    }
                }
            }
        }
    }

    Ok(addons)
}

