use base64::Engine;
use base64::prelude::BASE64_STANDARD;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use zip::ZipArchive;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedJarMetadata {
    pub file_name: String,
    pub mod_id: Option<String>,
    pub name: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub icon_data_url: Option<String>,
    pub curseforge_fingerprint: u32,
}

pub fn compute_curseforge_fingerprint(bytes: &[u8]) -> u32 {
    let filtered: Vec<u8> = bytes
        .iter()
        .copied()
        .filter(|&b| b != 9 && b != 10 && b != 13 && b != 32)
        .collect();
    murmur2::murmur2(&filtered, 1)
}

pub fn scan_jar_file(path: &Path) -> crate::Result<ScannedJarMetadata> {
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown.jar".to_string());

    let mut file_bytes = Vec::new();
    let mut f = File::open(path).map_err(|e| crate::ErrorKind::OtherError(e.to_string()))?;
    f.read_to_end(&mut file_bytes).map_err(|e| crate::ErrorKind::OtherError(e.to_string()))?;

    let fingerprint = compute_curseforge_fingerprint(&file_bytes);

    let cursor = std::io::Cursor::new(file_bytes);
    let mut archive = match ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(_) => {
            return Ok(ScannedJarMetadata {
                file_name: file_name.clone(),
                mod_id: None,
                name: file_name,
                version: None,
                description: None,
                icon_data_url: None,
                curseforge_fingerprint: fingerprint,
            });
        }
    };

    let mut mod_id = None;
    let mut name = None;
    let mut version = None;
    let mut description = None;
    let mut icon_path = None;

    // 1. Try fabric.mod.json
    if let Ok(mut fabric_entry) = archive.by_name("fabric.mod.json") {
        let mut buf = String::new();
        if fabric_entry.read_to_string(&mut buf).is_ok() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&buf) {
                mod_id = v.get("id").and_then(|x| x.as_str()).map(|s| s.to_string());
                name = v.get("name").and_then(|x| x.as_str()).map(|s| s.to_string());
                version = v.get("version").and_then(|x| x.as_str()).map(|s| s.to_string());
                description = v.get("description").and_then(|x| x.as_str()).map(|s| s.to_string());
                icon_path = v.get("icon").and_then(|x| x.as_str()).map(|s| s.to_string());
            }
        }
    }

    // 2. Try quilt.mod.json
    if name.is_none() {
        if let Ok(mut quilt_entry) = archive.by_name("quilt.mod.json") {
            let mut buf = String::new();
            if quilt_entry.read_to_string(&mut buf).is_ok() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&buf) {
                    if let Some(metadata) = v.get("quilt_loader").and_then(|x| x.get("metadata")) {
                        name = metadata.get("name").and_then(|x| x.as_str()).map(|s| s.to_string());
                        description = metadata.get("description").and_then(|x| x.as_str()).map(|s| s.to_string());
                    }
                    if let Some(id_val) = v.get("quilt_loader").and_then(|x| x.get("id")) {
                        mod_id = id_val.as_str().map(|s| s.to_string());
                    }
                }
            }
        }
    }

    // 3. Try META-INF/mods.toml (Forge/NeoForge)
    if name.is_none() {
        for toml_name in &["META-INF/mods.toml", "META-INF/neoforge.mods.toml"] {
            if let Ok(mut entry) = archive.by_name(toml_name) {
                let mut buf = String::new();
                if entry.read_to_string(&mut buf).is_ok() {
                    if let Ok(v) = toml::from_str::<toml::Value>(&buf) {
                        if let Some(mods_array) = v.get("mods").and_then(|x| x.as_array()) {
                            if let Some(first_mod) = mods_array.first() {
                                mod_id = first_mod.get("modId").and_then(|x| x.as_str()).map(|s| s.to_string());
                                name = first_mod.get("displayName").and_then(|x| x.as_str()).map(|s| s.to_string());
                                version = first_mod.get("version").and_then(|x| x.as_str()).map(|s| s.to_string());
                                description = first_mod.get("description").and_then(|x| x.as_str()).map(|s| s.to_string());
                                icon_path = first_mod.get("logoFile").and_then(|x| x.as_str()).map(|s| s.to_string());
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    // 4. Try mcmod.info (Legacy Forge)
    if name.is_none() {
        if let Ok(mut entry) = archive.by_name("mcmod.info") {
            let mut buf = String::new();
            if entry.read_to_string(&mut buf).is_ok() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&buf) {
                    let first = if v.is_array() {
                        v.as_array().and_then(|a| a.first())
                    } else if let Some(mod_list) = v.get("modList").and_then(|x| x.as_array()) {
                        mod_list.first()
                    } else {
                        None
                    };
                    if let Some(m) = first {
                        mod_id = m.get("modid").and_then(|x| x.as_str()).map(|s| s.to_string());
                        name = m.get("name").and_then(|x| x.as_str()).map(|s| s.to_string());
                        version = m.get("version").and_then(|x| x.as_str()).map(|s| s.to_string());
                        description = m.get("description").and_then(|x| x.as_str()).map(|s| s.to_string());
                        icon_path = m.get("logoFile").and_then(|x| x.as_str()).map(|s| s.to_string());
                    }
                }
            }
        }
    }

    // Extract icon if present
    let mut icon_data_url = None;
    if let Some(ref icon_file) = icon_path {
        let clean_path = icon_file.trim_start_matches('/');
        if let Ok(mut icon_entry) = archive.by_name(clean_path) {
            let mut icon_bytes = Vec::new();
            if icon_entry.read_to_end(&mut icon_bytes).is_ok() && !icon_bytes.is_empty() {
                let encoded = BASE64_STANDARD.encode(&icon_bytes);
                let mime = if clean_path.ends_with(".png") {
                    "image/png"
                } else if clean_path.ends_with(".jpg") || clean_path.ends_with(".jpeg") {
                    "image/jpeg"
                } else {
                    "image/png"
                };
                icon_data_url = Some(format!("data:{mime};base64,{encoded}"));
            }
        }
    }

    let final_name = name.unwrap_or_else(|| {
        file_name
            .strip_suffix(".jar")
            .unwrap_or(&file_name)
            .replace(['_', '-'], " ")
    });

    Ok(ScannedJarMetadata {
        file_name,
        mod_id,
        name: final_name,
        version,
        description,
        icon_data_url,
        curseforge_fingerprint: fingerprint,
    })
}

#[tracing::instrument]
pub async fn scan_instance_local_mods(instance_id: &str) -> crate::Result<Vec<ScannedJarMetadata>> {
    let target_dir = crate::api::instance::get_full_path(instance_id).await?;
    let mods_dir = target_dir.join("mods");
    if !mods_dir.exists() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    let mut rd = tokio::fs::read_dir(&mods_dir).await?;
    while let Some(entry) = rd.next_entry().await? {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "jar") {
            let path_clone = path.clone();
            let scanned = tokio::task::spawn_blocking(move || {
                scan_jar_file(&path_clone)
            }).await;
            if let Ok(Ok(meta)) = scanned {
                results.push(meta);
            }
        }
    }

    Ok(results)
}
