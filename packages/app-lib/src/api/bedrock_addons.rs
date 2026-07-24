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
    modules: Option<Vec<BedrockManifestModule>>,
}

#[derive(Debug, Deserialize)]
struct BedrockManifestHeader {
    uuid: String,
    name: String,
    description: Option<String>,
    version: Vec<u32>,
}

#[derive(Debug, Deserialize)]
struct BedrockManifestModule {
    #[serde(rename = "type")]
    module_type: String, // resource, data (behavior), etc.
}

pub async fn list_bedrock_addons(profile_path: &str) -> Result<Vec<BedrockAddon>> {
    let instance_path = crate::api::profile::get_full_path(profile_path).await?;
    let base_dir = instance_path.join("com.mojang");
    
    let mut addons = Vec::new();
    
    for kind in &["behavior_packs", "resource_packs"] {
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
                if let Ok(manifest) = serde_json::from_str::<BedrockManifest>(&content) {
                    let kind_str = if kind == &"resource_packs" {
                        "resource".to_string()
                    } else {
                        "behavior".to_string()
                    };
                    
                    let version_str = manifest.header.version.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(".");
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

pub async fn set_bedrock_addon_enabled(profile_path: &str, kind: &str, folder_name: &str, enable: bool) -> Result<()> {
    let instance_path = crate::api::profile::get_full_path(profile_path).await?;
    let kind_dir = if kind == "resource" { "resource_packs" } else { "behavior_packs" };
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
    let kind_dir = if kind == "resource" { "resource_packs" } else { "behavior_packs" };
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
    
    let instance_path = crate::api::profile::get_full_path(profile_path).await?;
    let com_mojang = instance_path.join("com.mojang");
    
    for pack_dir in manifests_found {
        let manifest_content = fs::read_to_string(pack_dir.join("manifest.json")).await.unwrap_or_default();
        if let Ok(manifest) = serde_json::from_str::<BedrockManifest>(&manifest_content) {
            let mut is_resource = false;
            if let Some(modules) = &manifest.modules {
                for m in modules {
                    if m.module_type.contains("resource") {
                        is_resource = true;
                        break;
                    }
                }
            }
            
            let kind_dir = if is_resource { "resource_packs" } else { "behavior_packs" };
            let target_base = com_mojang.join(kind_dir);
            let _ = fs::create_dir_all(&target_base).await;
            
            let target_path = target_base.join(&manifest.header.name);
            // If exists, delete first to overwrite or rename. We will just delete.
            if target_path.exists() {
                let _ = fs::remove_dir_all(&target_path).await;
            }
            
            // Move pack_dir to target_path
            let _ = fs::rename(&pack_dir, &target_path).await;
        }
    }
    
    let _ = fs::remove_dir_all(&temp_extract_dir).await;
    
    Ok(())
}

pub async fn check_bedrock_addon_updates(profile_path: &str) -> Result<Vec<BedrockAddon>> {
    let mut addons = list_bedrock_addons(profile_path).await?;

    for addon in &mut addons {
        if let Ok(search_results) = crate::api::bedrock_curseforge::search_addons(&addon.name, None, Some(4984), None).await {
            if let Some(match_mod) = search_results.into_iter().next() {
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
