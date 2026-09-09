use crate::state::State;
use crate::util::fetch::sha1_file_async;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DedupReport {
    pub scanned_files: usize,
    pub duplicate_files: usize,
    pub hardlinks_created: usize,
    pub bytes_saved: u64,
}

#[tracing::instrument]
pub async fn deduplicate_mods(target_instance: Option<String>) -> crate::Result<DedupReport> {
    let state = State::get().await?;
    let instances_dir = state.directories.instances_dir();

    let mut instance_paths = Vec::new();
    if let Some(ref inst_id) = target_instance {
        if let Ok(p) = crate::instance::get_full_path(inst_id).await {
            instance_paths.push(p);
        }
    } else if instances_dir.exists() {
        if let Ok(mut dir) = tokio::fs::read_dir(&instances_dir).await {
            while let Ok(Some(entry)) = dir.next_entry().await {
                if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                    instance_paths.push(entry.path());
                }
            }
        }
    }

    struct FileEntry {
        path: PathBuf,
        size: u64,
        hash: String,
    }

    let mut jar_entries = Vec::new();
    for inst_path in instance_paths {
        let mods_dir = inst_path.join("mods");
        if mods_dir.exists() {
            if let Ok(mut rd) = tokio::fs::read_dir(&mods_dir).await {
                while let Ok(Some(entry)) = rd.next_entry().await {
                    let p = entry.path();
                    if p.is_file() && p.extension().is_some_and(|ext| ext == "jar") {
                        if let Ok((size, hash)) = sha1_file_async(&p).await {
                            if size > 0 {
                                jar_entries.push(FileEntry { path: p, size, hash });
                            }
                        }
                    }
                }
            }
        }
    }

    let scanned_files = jar_entries.len();
    let mut hash_map: HashMap<(u64, String), PathBuf> = HashMap::new();
    let mut duplicate_files = 0;
    let mut hardlinks_created = 0;
    let mut bytes_saved = 0;

    for entry in jar_entries {
        let key = (entry.size, entry.hash);
        if let Some(primary) = hash_map.get(&key) {
            duplicate_files += 1;
            if primary != &entry.path {
                let temp_path = entry.path.with_extension("jar.dedup_tmp");
                if tokio::fs::rename(&entry.path, &temp_path).await.is_ok() {
                    match std::fs::hard_link(primary, &entry.path) {
                        Ok(()) => {
                            let _ = tokio::fs::remove_file(&temp_path).await;
                            hardlinks_created += 1;
                            bytes_saved += entry.size;
                        }
                        Err(_) => {
                            let _ = tokio::fs::rename(&temp_path, &entry.path).await;
                        }
                    }
                }
            }
        } else {
            hash_map.insert(key, entry.path);
        }
    }

    Ok(DedupReport {
        scanned_files,
        duplicate_files,
        hardlinks_created,
        bytes_saved,
    })
}
