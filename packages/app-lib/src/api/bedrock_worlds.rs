use crate::{Result, ErrorKind};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;
use tokio_util::compat::FuturesAsyncReadCompatExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BedrockWorld {
    pub folder_name: String,
    pub name: String,
    pub size_bytes: u64,
    pub last_played: u64,
    pub icon_path: Option<String>,
    pub is_valid: bool,
}

pub async fn list_bedrock_worlds(profile_path: &str) -> Result<Vec<BedrockWorld>> {
    let instance_path = crate::api::instance::get_full_path_by_path(profile_path).await?;
    let worlds_dir = instance_path.join("com.mojang").join("minecraftWorlds");
    
    let mut worlds = Vec::new();
    
    if !worlds_dir.exists() {
        return Ok(worlds);
    }
    
    let mut entries = fs::read_dir(&worlds_dir).await?;
    
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        
        let folder_name = entry.file_name().to_string_lossy().to_string();
        
        let levelname_path = path.join("levelname.txt");
        let name = if levelname_path.exists() {
            fs::read_to_string(&levelname_path).await.unwrap_or_else(|_| "Unknown World".to_string())
        } else {
            "Unknown World".to_string()
        };
        
        let icon_path = path.join("world_icon.jpeg");
        let icon_str = if icon_path.exists() {
            Some(icon_path.to_string_lossy().to_string())
        } else {
            None
        };
        
        // Calculate size by walking dir
        let mut size_bytes = 0;
        let mut last_played = 0;
        let mut stack = vec![path.clone()];
        while let Some(dir) = stack.pop() {
            if let Ok(mut sub_entries) = fs::read_dir(&dir).await {
                while let Ok(Some(sub_entry)) = sub_entries.next_entry().await {
                    if let Ok(meta) = sub_entry.metadata().await {
                        if meta.is_dir() {
                            stack.push(sub_entry.path());
                        } else {
                            size_bytes += meta.len();
                            if let Ok(modified) = meta.modified() {
                                if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
                                    let s = duration.as_secs();
                                    if s > last_played {
                                        last_played = s;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Minecraft requires a real LevelDB database (db/ folder with actual chunk
        // files) to load a world - levelname.txt/world_icon.jpeg are purely cosmetic
        // and their presence alone does NOT mean the world is actually loadable in-game.
        let db_dir = path.join("db");
        let has_level_dat = fs::metadata(path.join("level.dat")).await.is_ok();
        let mut has_db_contents = false;
        if let Ok(mut db_entries) = fs::read_dir(&db_dir).await {
            if let Ok(Some(_)) = db_entries.next_entry().await {
                has_db_contents = true;
            }
        }
        let is_valid = has_level_dat && has_db_contents;

        worlds.push(BedrockWorld {
            folder_name,
            name,
            size_bytes,
            last_played,
            icon_path: icon_str,
            is_valid,
        });
    }
    
    // Sort by last played
    worlds.sort_by(|a, b| b.last_played.cmp(&a.last_played));
    
    Ok(worlds)
}

pub async fn delete_bedrock_world(profile_path: &str, folder_name: &str) -> Result<()> {
    let instance_path = crate::api::instance::get_full_path_by_path(profile_path).await?;
    let path = instance_path.join("com.mojang").join("minecraftWorlds").join(folder_name);
    
    if path.exists() && path.is_dir() {
        fs::remove_dir_all(path).await?;
    }
    
    Ok(())
}

pub async fn export_bedrock_world(profile_path: &str, folder_name: &str, out_path: &str) -> Result<()> {
    let instance_path = crate::api::instance::get_full_path_by_path(profile_path).await?;
    let world_dir = instance_path.join("com.mojang").join("minecraftWorlds").join(folder_name);
    
    if !world_dir.exists() {
        return Err(ErrorKind::OtherError("World folder not found".into()).into());
    }
    
    let out_file = std::fs::File::create(out_path)?;
    let mut zip = zip::ZipWriter::new(out_file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    
    let mut stack = vec![world_dir.clone()];
    while let Some(dir) = stack.pop() {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = path.strip_prefix(&world_dir).unwrap().to_string_lossy().replace("\\", "/");
                
                if path.is_dir() {
                    zip.add_directory(name, options).map_err(|e| ErrorKind::OtherError(e.to_string()))?;
                    stack.push(path);
                } else {
                    zip.start_file(name, options).map_err(|e| ErrorKind::OtherError(e.to_string()))?;
                    let mut f = std::fs::File::open(&path)?;
                    std::io::copy(&mut f, &mut zip).map_err(|e| ErrorKind::OtherError(e.to_string()))?;
                }
            }
        }
    }
    zip.finish().map_err(|e| ErrorKind::OtherError(e.to_string()))?;
    
    Ok(())
}

pub async fn import_bedrock_world(profile_path: &str, archive_path: &str) -> Result<()> {
    use async_zip::tokio::read::fs::ZipFileReader;
    
    let file_path = PathBuf::from(archive_path);
    if !file_path.exists() {
        return Err(ErrorKind::OtherError("Archive not found".into()).into());
    }
    
    let instance_path = crate::api::instance::get_full_path_by_path(profile_path).await?;
    let target_uuid = uuid::Uuid::new_v4().to_string();
    let out_dir = instance_path.join("com.mojang").join("minecraftWorlds").join(&target_uuid);
    
    fs::create_dir_all(&out_dir).await?;
    
    let reader = match ZipFileReader::new(&file_path).await {
        Ok(r) => r,
        Err(_) => return Err(ErrorKind::OtherError("Failed to open zip archive".into()).into()),
    };
    
    for i in 0..reader.file().entries().len() {
        let entry = reader.file().entries().get(i).unwrap();
        if let Ok(filename) = entry.filename().as_str() {
            let out_path = out_dir.join(filename);
            
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
    
    // Sometimes worlds are packaged inside a root folder. Let's lift it if that's the case.
    let mut entries = fs::read_dir(&out_dir).await?;
    let mut items = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        items.push(entry.path());
    }
    
    if items.len() == 1 && items[0].is_dir() {
        // Lift contents
        let inner_dir = items[0].clone();
        let mut inner_entries = fs::read_dir(&inner_dir).await?;
        while let Ok(Some(e)) = inner_entries.next_entry().await {
            let _ = fs::rename(e.path(), out_dir.join(e.file_name())).await;
        }
        let _ = fs::remove_dir_all(inner_dir).await;
    }
    
    Ok(())
}

/// Maximum number of snapshots kept per world (rotation limit).
const MAX_WORLD_BACKUPS: usize = 10;

/// Information about a single world backup snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BedrockWorldBackup {
    pub folder_name: String,
    pub backup_name: String,
    pub created: u64,
    pub size_bytes: u64,
}

/// Creates automatic backup snapshots of Bedrock worlds before launching the game.
/// Stores up to [`MAX_WORLD_BACKUPS`] latest snapshots per world to prevent data
/// loss from crashes/power loss.
pub async fn auto_backup_bedrock_worlds(profile_path: &str) -> Result<()> {
    let instance_path = match crate::api::instance::get_full_path_by_path(profile_path).await {
        Ok(p) => p,
        Err(_) => return Ok(()),
    };

    let worlds_dir = instance_path.join("com.mojang").join("minecraftWorlds");
    if !worlds_dir.exists() {
        return Ok(());
    }

    let backups_base_dir = instance_path.join("auto_world_backups");
    let _ = fs::create_dir_all(&backups_base_dir).await;

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();

    let mut entries = match fs::read_dir(&worlds_dir).await {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let world_path = entry.path();
        if !world_path.is_dir() {
            continue;
        }

        let folder_name = entry.file_name().to_string_lossy().to_string();
        let world_backup_dir = backups_base_dir.join(&folder_name);
        let current_backup_path = world_backup_dir.join(format!("backup_{}", timestamp));

        // Copy world recursively to backup
        if let Err(e) = copy_dir_all(&world_path, &current_backup_path).await {
            tracing::warn!("Failed auto-backup for world {folder_name}: {e}");
            continue;
        }

        // Keep only the newest MAX_WORLD_BACKUPS backups
        if let Ok(mut backup_entries) = fs::read_dir(&world_backup_dir).await {
            let mut list = Vec::new();
            while let Ok(Some(b_entry)) = backup_entries.next_entry().await {
                if b_entry.path().is_dir() {
                    list.push(b_entry.path());
                }
            }
            if list.len() > MAX_WORLD_BACKUPS {
                list.sort();
                for old in list.iter().take(list.len() - MAX_WORLD_BACKUPS) {
                    let _ = fs::remove_dir_all(old).await;
                }
            }
        }
    }

    Ok(())
}

/// Lists all backup snapshots for every world of the given profile,
/// newest first. Reads from the `auto_world_backups` directory.
pub async fn list_bedrock_world_backups(profile_path: &str) -> Result<Vec<BedrockWorldBackup>> {
    let instance_path = crate::api::instance::get_full_path_by_path(profile_path).await?;
    let backups_base_dir = instance_path.join("auto_world_backups");

    let mut backups = Vec::new();

    if !backups_base_dir.exists() {
        return Ok(backups);
    }

    let mut world_entries = match fs::read_dir(&backups_base_dir).await {
        Ok(e) => e,
        Err(_) => return Ok(backups),
    };

    while let Ok(Some(world_entry)) = world_entries.next_entry().await {
        let world_backup_dir = world_entry.path();
        if !world_backup_dir.is_dir() {
            continue;
        }
        let folder_name = world_entry.file_name().to_string_lossy().to_string();

        let mut backup_entries = match fs::read_dir(&world_backup_dir).await {
            Ok(e) => e,
            Err(_) => continue,
        };

        while let Ok(Some(b_entry)) = backup_entries.next_entry().await {
            let backup_path = b_entry.path();
            if !backup_path.is_dir() {
                continue;
            }
            let backup_name = b_entry.file_name().to_string_lossy().to_string();

            let mut created = 0u64;
            let mut size_bytes = 0u64;
            if let Ok(meta) = b_entry.metadata().await {
                if let Ok(modified) = meta.modified() {
                    if let Ok(d) = modified.duration_since(std::time::UNIX_EPOCH) {
                        created = d.as_secs();
                    }
                }
            }
            // Compute size by walking the snapshot dir
            let mut stack = vec![backup_path.clone()];
            while let Some(dir) = stack.pop() {
                if let Ok(mut sub) = fs::read_dir(&dir).await {
                    while let Ok(Some(se)) = sub.next_entry().await {
                        if let Ok(m) = se.metadata().await {
                            if m.is_dir() {
                                stack.push(se.path());
                            } else {
                                size_bytes += m.len();
                            }
                        }
                    }
                }
            }

            backups.push(BedrockWorldBackup {
                folder_name: folder_name.clone(),
                backup_name,
                created,
                size_bytes,
            });
        }
    }

    // Newest first
    backups.sort_by(|a, b| b.created.cmp(&a.created));
    Ok(backups)
}

/// Restores a world from the given backup snapshot, replacing current contents.
pub async fn restore_bedrock_world_backup(
    profile_path: &str,
    folder_name: &str,
    backup_name: &str,
) -> Result<()> {
    let instance_path = crate::api::instance::get_full_path_by_path(profile_path).await?;
    let backup_path = instance_path
        .join("auto_world_backups")
        .join(folder_name)
        .join(backup_name);
    let world_path = instance_path
        .join("com.mojang")
        .join("minecraftWorlds")
        .join(folder_name);

    if !backup_path.exists() {
        return Err(ErrorKind::OtherError(format!(
            "Backup {backup_name} for world {folder_name} not found"
        ))
        .into());
    }

    if world_path.exists() {
        fs::remove_dir_all(&world_path).await?;
    }
    copy_dir_all(&backup_path, &world_path).await?;
    Ok(())
}

/// Deletes a single backup snapshot.
pub async fn delete_bedrock_world_backup(
    profile_path: &str,
    folder_name: &str,
    backup_name: &str,
) -> Result<()> {
    let instance_path = crate::api::instance::get_full_path_by_path(profile_path).await?;
    let backup_path = instance_path
        .join("auto_world_backups")
        .join(folder_name)
        .join(backup_name);

    if backup_path.exists() && backup_path.is_dir() {
        fs::remove_dir_all(backup_path).await?;
    }
    Ok(())
}

/// Manually creates a backup snapshot of a single world (used by the
/// "Backups" UI button). Applies the same rotation limit.
pub async fn backup_bedrock_world_now(profile_path: &str, folder_name: &str) -> Result<()> {
    let instance_path = crate::api::instance::get_full_path_by_path(profile_path).await?;
    let world_path = instance_path
        .join("com.mojang")
        .join("minecraftWorlds")
        .join(folder_name);

    if !world_path.exists() {
        return Err(ErrorKind::OtherError(format!(
            "World {folder_name} not found"
        ))
        .into());
    }

    let world_backup_dir = instance_path.join("auto_world_backups").join(folder_name);
    let _ = fs::create_dir_all(&world_backup_dir).await;

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let current_backup_path = world_backup_dir.join(format!("backup_{}", timestamp));
    copy_dir_all(&world_path, &current_backup_path).await?;

    // Rotate
    if let Ok(mut backup_entries) = fs::read_dir(&world_backup_dir).await {
        let mut list = Vec::new();
        while let Ok(Some(b_entry)) = backup_entries.next_entry().await {
            if b_entry.path().is_dir() {
                list.push(b_entry.path());
            }
        }
        if list.len() > MAX_WORLD_BACKUPS {
            list.sort();
            for old in list.iter().take(list.len() - MAX_WORLD_BACKUPS) {
                let _ = fs::remove_dir_all(old).await;
            }
        }
    }

    Ok(())
}

/// Checks if any Bedrock world was corrupted during a crash (missing db files)
/// and automatically restores the latest safe backup if available.
pub async fn verify_and_restore_corrupted_worlds(profile_path: &str) -> Result<()> {
    let instance_path = match crate::api::instance::get_full_path_by_path(profile_path).await {
        Ok(p) => p,
        Err(_) => return Ok(()),
    };

    let worlds_dir = instance_path.join("com.mojang").join("minecraftWorlds");
    let backups_base_dir = instance_path.join("auto_world_backups");

    if !worlds_dir.exists() || !backups_base_dir.exists() {
        return Ok(());
    }

    let mut entries = match fs::read_dir(&worlds_dir).await {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let world_path = entry.path();
        if !world_path.is_dir() {
            continue;
        }

        let folder_name = entry.file_name().to_string_lossy().to_string();
        let db_dir = world_path.join("db");
        let has_level_dat = fs::metadata(world_path.join("level.dat")).await.is_ok();
        let mut has_db_contents = false;

        if let Ok(mut db_entries) = fs::read_dir(&db_dir).await {
            if let Ok(Some(_)) = db_entries.next_entry().await {
                has_db_contents = true;
            }
        }

        // If world is corrupted (missing level.dat or empty db)
        if !has_level_dat || !has_db_contents {
            let world_backup_dir = backups_base_dir.join(&folder_name);
            if world_backup_dir.exists() {
                if let Ok(mut backup_entries) = fs::read_dir(&world_backup_dir).await {
                    let mut list = Vec::new();
                    while let Ok(Some(b_entry)) = backup_entries.next_entry().await {
                        if b_entry.path().is_dir() {
                            list.push(b_entry.path());
                        }
                    }
                    if let Some(latest_backup) = list.into_iter().max() {
                        tracing::info!("Restoring corrupted world {folder_name} from safe backup {:?}", latest_backup);
                        let _ = fs::remove_dir_all(&world_path).await;
                        let _ = copy_dir_all(&latest_backup, &world_path).await;
                    }
                }
            }
        }
    }

    Ok(())
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
            fs::copy(&src_path, &dst_path).await?;
        }
    }
    Ok(())
}
