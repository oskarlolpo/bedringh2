use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use crate::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedExternalInstance {
    pub id: String,
    pub launcher_name: String,
    pub display_name: String,
    pub original_name: String,
    pub game_version: String,
    pub loader: String,
    pub root_path: String,
    pub mods_count: usize,
}

#[tracing::instrument]
pub async fn detect_external_instances() -> crate::Result<Vec<DetectedExternalInstance>> {
    let mut detected = Vec::new();

    // 1. CurseForge: home_dir/curseforge/minecraft/Instances
    if let Some(home) = dirs::home_dir() {
        let cf_instances = home.join("curseforge").join("minecraft").join("Instances");
        if cf_instances.exists() {
            if let Ok(mut rd) = tokio::fs::read_dir(&cf_instances).await {
                while let Ok(Some(entry)) = rd.next_entry().await {
                    if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                        let path = entry.path();
                        let manifest_file = path.join("minecraftinstance.json");
                        let mut name = entry.file_name().to_string_lossy().to_string();
                        let mut game_version = "1.20.1".to_string();
                        let mut loader = "forge".to_string();

                        if manifest_file.exists() {
                            if let Ok(content) = tokio::fs::read_to_string(&manifest_file).await {
                                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                                    if let Some(n) = v.get("name").and_then(|x| x.as_str()) {
                                        name = n.to_string();
                                    }
                                    if let Some(gv) = v.get("gameVersion").and_then(|x| x.as_str()) {
                                        game_version = gv.to_string();
                                    }
                                    if let Some(bml) = v.get("baseModLoader").and_then(|x| x.get("name")).and_then(|x| x.as_str()) {
                                        let bml_lower = bml.to_lowercase();
                                        if bml_lower.contains("fabric") {
                                            loader = "fabric".to_string();
                                        } else if bml_lower.contains("neoforge") {
                                            loader = "neoforge".to_string();
                                        } else if bml_lower.contains("quilt") {
                                            loader = "quilt".to_string();
                                        } else {
                                            loader = "forge".to_string();
                                        }
                                    }
                                }
                            }
                        }

                        let mods_count = count_mods_in_dir(&path.join("mods")).await;
                        detected.push(DetectedExternalInstance {
                            id: format!("cf_{}", name),
                            launcher_name: "CurseForge".to_string(),
                            display_name: format!("[CurseForge] {}", name),
                            original_name: name,
                            game_version,
                            loader,
                            root_path: path.to_string_lossy().to_string(),
                            mods_count,
                        });
                    }
                }
            }
        }
    }

    // 2. Prism Launcher & MultiMC & ATLauncher
    let app_data = dirs::data_dir().or_else(dirs::config_dir);
    if let Some(ref base_data) = app_data {
        for (launcher_label, folder_name) in [
            ("Prism Launcher", "PrismLauncher"),
            ("MultiMC", "MultiMC"),
            ("ATLauncher", "ATLauncher"),
        ] {
            let instances_dir = base_data.join(folder_name).join("instances");
            if instances_dir.exists() {
                if let Ok(mut rd) = tokio::fs::read_dir(&instances_dir).await {
                    while let Ok(Some(entry)) = rd.next_entry().await {
                        if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                            let path = entry.path();
                            let mut name = entry.file_name().to_string_lossy().to_string();
                            let mut game_version = "1.20.1".to_string();
                            let mut loader = "fabric".to_string();

                            let cfg_file = path.join("instance.cfg");
                            if cfg_file.exists() {
                                if let Ok(cfg_content) = tokio::fs::read_to_string(&cfg_file).await {
                                    for line in cfg_content.lines() {
                                        if let Some(val) = line.strip_prefix("name=") {
                                            name = val.trim().to_string();
                                        } else if let Some(val) = line.strip_prefix("IntendedVersion=") {
                                            game_version = val.trim().to_string();
                                        }
                                    }
                                }
                            }

                            let mc_dir = if path.join(".minecraft").exists() {
                                path.join(".minecraft")
                            } else if path.join("minecraft").exists() {
                                path.join("minecraft")
                            } else {
                                path.clone()
                            };

                            let mods_count = count_mods_in_dir(&mc_dir.join("mods")).await;
                            detected.push(DetectedExternalInstance {
                                id: format!("{}_{}", folder_name.to_lowercase(), name),
                                launcher_name: launcher_label.to_string(),
                                display_name: format!("[{}] {}", launcher_label, name),
                                original_name: name,
                                game_version,
                                loader,
                                root_path: mc_dir.to_string_lossy().to_string(),
                                mods_count,
                            });
                        }
                    }
                }
            }
        }

        // 3. TLauncher / Legacy Launcher / .minecraft/versions
        let dot_mc_versions = base_data.join(".minecraft").join("versions");
        if dot_mc_versions.exists() {
            if let Ok(mut rd) = tokio::fs::read_dir(&dot_mc_versions).await {
                while let Ok(Some(entry)) = rd.next_entry().await {
                    if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                        let path = entry.path();
                        let name = entry.file_name().to_string_lossy().to_string();
                        let mods_dir = path.join("mods");
                        let mods_count = count_mods_in_dir(&mods_dir).await;
                        if mods_count > 0 {
                            detected.push(DetectedExternalInstance {
                                id: format!("legacy_{}", name),
                                launcher_name: "Legacy/TLauncher".to_string(),
                                display_name: format!("[Legacy] {}", name),
                                original_name: name.clone(),
                                game_version: "1.20.1".to_string(),
                                loader: if name.to_lowercase().contains("forge") { "forge".to_string() } else { "fabric".to_string() },
                                root_path: path.to_string_lossy().to_string(),
                                mods_count,
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(detected)
}

async fn count_mods_in_dir(path: &Path) -> usize {
    if !path.exists() {
        return 0;
    }
    let mut count = 0;
    if let Ok(mut rd) = tokio::fs::read_dir(path).await {
        while let Ok(Some(entry)) = rd.next_entry().await {
            if entry.path().extension().is_some_and(|e| e == "jar") {
                count += 1;
            }
        }
    }
    count
}

#[tracing::instrument]
pub async fn import_external_instance(detected: DetectedExternalInstance) -> crate::Result<String> {
    let loader_enum = crate::state::ModLoader::from_string(&detected.loader);
    let meta = crate::api::instance::create(
        detected.display_name.clone(),
        detected.game_version.clone(),
        loader_enum,
        Some("latest".to_string()),
        None,
        None,
        crate::state::InstanceLink::Unmanaged,
    )
    .await?;

    let target_dir = crate::api::instance::get_full_path(&meta.instance.id).await?;
    let src_root = PathBuf::from(&detected.root_path);

    for sub in &["mods", "config", "saves", "resourcepacks", "shaderpacks"] {
        let src_sub = src_root.join(sub);
        let dst_sub = target_dir.join(sub);
        if src_sub.is_dir() {
            copy_dir_all(&src_sub, &dst_sub).await?;
        }
    }

    let options_file = src_root.join("options.txt");
    if options_file.is_file() {
        let _ = tokio::fs::copy(&options_file, target_dir.join("options.txt")).await;
    }

    Ok(meta.instance.id)
}

fn copy_dir_all<'a>(src: &'a Path, dst: &'a Path) -> std::pin::Pin<Box<dyn std::future::Future<Output = crate::Result<()>> + Send + 'a>> {
    Box::pin(async move {
        if !dst.exists() {
            tokio::fs::create_dir_all(dst).await?;
        }
        let mut rd = tokio::fs::read_dir(src).await?;
        while let Some(entry) = rd.next_entry().await? {
            let ty = entry.file_type().await?;
            let src_path = entry.path();
            let dst_path = dst.join(entry.file_name());
            if ty.is_dir() {
                copy_dir_all(&src_path, &dst_path).await?;
            } else if ty.is_file() {
                // Try hardlink first, fallback to copy
                if std::fs::hard_link(&src_path, &dst_path).is_err() {
                    let _ = tokio::fs::copy(&src_path, &dst_path).await;
                }
            }
        }
        Ok(())
    })
}

