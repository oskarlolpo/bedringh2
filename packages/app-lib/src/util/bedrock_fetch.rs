use crate::event::emit::emit_loading;
use crate::event::LoadingBarType;
use crate::state::DirectoryInfo;
use crate::ErrorKind;
use reqwest::header::RANGE;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs::{self, File};
use tokio::io::{AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio::sync::Semaphore;

const CHUNK_SIZE: u64 = 32 * 1024 * 1024; // 32 MB
const MAX_CONCURRENT_DOWNLOADS: usize = 6;

#[derive(Serialize, Deserialize, Default)]
struct DownloadState {
    chunks_completed: Vec<u64>,
}

#[tracing::instrument(skip(client))]
pub async fn download_bedrock_package(
    url: &str,
    filename: &str,
    profile_name: &str,
    profile_path: &str,
    loading_bar: &crate::event::LoadingBarId,
    client: &Client,
) -> crate::Result<PathBuf> {
    let dirs = DirectoryInfo::global_handle_if_ready()
        .ok_or_else(|| ErrorKind::FSError("App directories not initialized".to_string()))?;

    let cache_dir = dirs.caches_dir().join("bedrock_packages");
    if !cache_dir.exists() {
        fs::create_dir_all(&cache_dir).await.map_err(|e| {
            crate::Error::from(ErrorKind::FSError(format!("Failed to create bedrock cache dir: {e}")))
        })?;
    }

    let target_path = cache_dir.join(filename);
    if target_path.exists() {
        return Ok(target_path);
    }

    let state_path = cache_dir.join(format!("{filename}.state.json"));
    let part_path = cache_dir.join(format!("{filename}.part"));

    // 1. Get Content-Length
    let head_resp = client
        .head(url)
        .send()
        .await
        .map_err(|e| ErrorKind::FetchError(e))?;
    
    let parsed_len = head_resp
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());

    let total_size = parsed_len.or_else(|| head_resp.content_length()).ok_or_else(|| {
        ErrorKind::OtherError("No content-length for Bedrock package".to_string())
    })?;

    if total_size == 0 {
        return Err(crate::Error::from(ErrorKind::OtherError(
            "Content-Length is 0! The HEAD request failed to get the true file size.".to_string(),
        )));
    }

    let _ = crate::event::emit::edit_loading(
        loading_bar,
        LoadingBarType::MinecraftDownload {
            profile_name: profile_name.to_string(),
            profile_path: profile_path.to_string(),
        },
        total_size as f64,
        "Скачивание Bedrock...",
    ).await;

    // 3. Load State
    let mut state: DownloadState = if state_path.exists() {
        let content: String = fs::read_to_string(&state_path).await.unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        DownloadState::default()
    };

    let total_chunks = (total_size as f64 / CHUNK_SIZE as f64).ceil() as u64;

    // 4. Pre-allocate sparse file if it doesn't exist
    if !part_path.exists() {
        let file: File = File::create(&part_path).await?;
        file.set_len(total_size).await?;
    }

    let downloaded_bytes: u64 = state.chunks_completed.len() as u64 * CHUNK_SIZE;
    let _ = emit_loading(
        &loading_bar,
        downloaded_bytes as f64, // Wait, emit_loading takes increment, not total downloaded! 
        Some("Загрузка пакета..."),
    ); // ACTUALLY, for initial tick it's safe to just increment by what's already done.

    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_DOWNLOADS));
    let mut tasks = vec![];

    let url_arc = Arc::new(url.to_string());
    let part_path_arc = Arc::new(part_path.clone());

    let (tx, mut rx) = tokio::sync::mpsc::channel(100);

    for chunk_idx in 0..total_chunks {
        if state.chunks_completed.contains(&chunk_idx) {
            continue;
        }

        let start = chunk_idx * CHUNK_SIZE;
        let end = std::cmp::min(start + CHUNK_SIZE - 1, total_size - 1);
        let semaphore = semaphore.clone();
        let client = client.clone();
        let url = url_arc.clone();
        let path = part_path_arc.clone();
        let tx = tx.clone();

        tasks.push(tokio::spawn(async move {
            let permit = semaphore.acquire_owned().await.unwrap();
            let mut attempts = 0;
            loop {
                attempts += 1;
                let req = client
                    .get(url.as_str())
                    .header(RANGE, format!("bytes={}-{}", start, end))
                    .send()
                    .await;

                match req {
                    Ok(mut resp) => {
                        if !resp.status().is_success() {
                            if attempts >= 3 {
                                return Err(crate::Error::from(ErrorKind::OtherError(
                                    format!("HTTP {}", resp.status()),
                                )));
                            }
                            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                            continue;
                        }

                        let mut std_opts = std::fs::OpenOptions::new();
                        std_opts.write(true);
                        #[cfg(target_os = "windows")]
                        {
                            use std::os::windows::fs::OpenOptionsExt;
                            std_opts.share_mode(3); // FILE_SHARE_READ | FILE_SHARE_WRITE
                        }
                        let mut file: File = tokio::fs::OpenOptions::from(std_opts)
                            .open(path.as_ref())
                            .await?;
                        file.seek(SeekFrom::Start(start)).await?;

                        while let Some(chunk) = resp.chunk().await.map_err(|e| {
                            crate::Error::from(ErrorKind::FetchError(e))
                        })? {
                            file.write_all(&chunk).await?;
                            let _ = tx.send(chunk.len() as f64).await;
                        }
                        break;
                    }
                    Err(e) => {
                        if attempts >= 3 {
                            return Err(crate::Error::from(ErrorKind::FetchError(e)));
                        }
                        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    }
                }
            }
            drop(permit);
            Ok::<u64, crate::Error>(chunk_idx)
        }));
    }

    drop(tx);

    // Process progress updates sequentially in the current task
    // Since download tasks are spawned, they run concurrently.
    while let Some(bytes) = rx.recv().await {
        let _ = emit_loading(loading_bar, bytes, Some("Загрузка пакета..."));
    }

    for task in tasks {
        match task.await.unwrap() {
            Ok(idx) => {
                state.chunks_completed.push(idx);
                if let Ok(state_str) = serde_json::to_string(&state) {
                    let _ = fs::write(&state_path, state_str).await;
                }
            }
            Err(e) => {
                return Err(e);
            }
        }
    }

    // The backend uses emit_loading directly to increment. If the total is reached, it will emit None internally.
    // However, to ensure it finishes gracefully even if bytes mismatch:
    let _ = emit_loading(&loading_bar, total_size as f64, Some("Установка..."));

    fs::rename(&part_path, &target_path).await?;
    let _ = fs::remove_file(&state_path).await;

    Ok(target_path)
}
