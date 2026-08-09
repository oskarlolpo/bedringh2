use crate::ErrorKind;
use crate::event::LoadingBarType;
use crate::event::emit::emit_loading;
use crate::state::DirectoryInfo;
use reqwest::Client;
use reqwest::header::RANGE;
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

pub async fn download_bedrock_package(
    url: &str,
    filename: &str,
    profile_name: &str,
    profile_path: &str,
    loading_bar: &crate::event::LoadingBarId,
    client: &Client,
    repairing: bool,
    reporter: Option<&crate::install::InstallProgressReporter>,
    phase_details: Option<&crate::install::InstallPhaseDetails>,
) -> crate::Result<PathBuf> {
    let urls: Vec<&str> = url.split(',').collect();
    if urls.len() == 1 {
        return download_single_file(url, filename, profile_name, profile_path, loading_bar, client, repairing, reporter, phase_details).await;
    }

    let dirs = DirectoryInfo::global_handle_if_ready().ok_or_else(|| {
        ErrorKind::FSError("App directories not initialized".to_string())
    })?;
    let cache_dir = dirs.caches_dir().join("bedrock_packages");
    let merged_path = cache_dir.join(filename);

    if repairing && merged_path.exists() {
        let _ = fs::remove_file(&merged_path).await;
    }

    if merged_path.exists() {
        return Ok(merged_path);
    }

    let mut downloaded_parts = vec![];
    let mut expected_total_size = 0;

    for (i, part_url) in urls.iter().enumerate() {
        let part_filename = format!("{filename}.{:03}", i + 1);
        let part_profile_name = format!("{profile_name} (Part {})", i + 1);
        
        let path = download_single_file(
            part_url,
            &part_filename,
            &part_profile_name,
            profile_path,
            loading_bar,
            client,
            repairing,
            reporter,
            phase_details,
        )
        .await?;

        let meta = std::fs::metadata(&path).map_err(|e| crate::Error::from(ErrorKind::OtherError(e.to_string())))?;
        expected_total_size += meta.len();
        downloaded_parts.push(path);
    }

    if downloaded_parts.is_empty() {
        return Err(crate::Error::from(ErrorKind::OtherError("No files downloaded".to_string())));
    }

    let _ = emit_loading(
        loading_bar,
        0.0,
        Some("Объединение томов архива..."),
    );

    let merged_path_clone = merged_path.clone();
    tokio::task::spawn_blocking(move || -> crate::Result<()> {
        let mut out = std::fs::File::create(&merged_path_clone)?;
        for part in downloaded_parts {
            let mut in_file = std::fs::File::open(part)?;
            std::io::copy(&mut in_file, &mut out)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| crate::Error::from(ErrorKind::OtherError(e.to_string())))??;

    let merged_meta = std::fs::metadata(&merged_path).map_err(|e| crate::Error::from(ErrorKind::OtherError(e.to_string())))?;
    if merged_meta.len() != expected_total_size {
        let _ = fs::remove_file(&merged_path).await;
        return Err(crate::Error::from(ErrorKind::OtherError("Размер объединенного архива не совпадает с ожидаемым".to_string())));
    }

    Ok(merged_path)
}

#[tracing::instrument(skip(client))]
pub async fn download_single_file(
    url: &str,
    filename: &str,
    profile_name: &str,
    profile_path: &str,
    loading_bar: &crate::event::LoadingBarId,
    client: &Client,
    repairing: bool,
    reporter: Option<&crate::install::InstallProgressReporter>,
    phase_details: Option<&crate::install::InstallPhaseDetails>,
) -> crate::Result<PathBuf> {
    let dirs = DirectoryInfo::global_handle_if_ready().ok_or_else(|| {
        ErrorKind::FSError("App directories not initialized".to_string())
    })?;

    let cache_dir = dirs.caches_dir().join("bedrock_packages");
    if !cache_dir.exists() {
        fs::create_dir_all(&cache_dir).await.map_err(|e| {
            crate::Error::from(ErrorKind::FSError(format!(
                "Failed to create bedrock cache dir: {e}"
            )))
        })?;
    }

    let target_path = cache_dir.join(filename);

    if repairing && target_path.exists() {
        let _ = fs::remove_file(&target_path).await;
    }

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

    let total_size = parsed_len
        .or_else(|| head_resp.content_length())
        .ok_or_else(|| {
            ErrorKind::OtherError(
                "No content-length for Bedrock package".to_string(),
            )
        })?;

    if total_size == 0 {
        return Err(crate::Error::from(ErrorKind::OtherError(
            "Content-Length is 0! The HEAD request failed to get the true file size.".to_string(),
        )));
    }

    let _ = crate::event::emit::edit_loading(
        loading_bar,
        LoadingBarType::MinecraftDownload {
            instance_id: profile_path.to_string(),
            instance_name: profile_name.to_string(),
        },
        total_size as f64,
        "Скачивание Bedrock...",
    )
    .await;

    // 3. Load State
    let mut state: DownloadState = if state_path.exists() {
        let content: String =
            fs::read_to_string(&state_path).await.unwrap_or_default();
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

    let _downloaded_bytes: u64 =
        state.chunks_completed.len() as u64 * CHUNK_SIZE;
    // Don't emit accumulated progress to avoid jumping behavior when resuming, 
    // since emit_loading is increment-based and starts at 0.

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
            let permit = semaphore.acquire_owned().await.map_err(|e| crate::Error::from(
                ErrorKind::OtherError(format!("Semaphore error: {}", e))
            ))?;
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
                                return Err(crate::Error::from(
                                    ErrorKind::OtherError(format!(
                                        "HTTP {}",
                                        resp.status()
                                    )),
                                ));
                            }
                            tokio::time::sleep(std::time::Duration::from_secs(
                                1,
                            ))
                            .await;
                            continue;
                        }

                        let mut std_opts = std::fs::OpenOptions::new();
                        std_opts.write(true);
                        #[cfg(target_os = "windows")]
                        {
                            use std::os::windows::fs::OpenOptionsExt;
                            std_opts.share_mode(3); // FILE_SHARE_READ | FILE_SHARE_WRITE
                        }
                        let mut file: File =
                            tokio::fs::OpenOptions::from(std_opts)
                                .open(path.as_ref())
                                .await?;
                        file.seek(SeekFrom::Start(start)).await?;

                        // If the connection drops mid-stream (common with several
                        // parallel Range requests hitting a bare github.com redirect
                        // URL), retry the whole chunk instead of failing the entire
                        // download outright - a mid-stream error here used to
                        // propagate immediately via `?` with no retry at all.
                        let mut stream_failed = false;
                        let mut bytes_written_this_attempt: u64 = 0;
                        loop {
                            match resp.chunk().await {
                                Ok(Some(chunk)) => {
                                    file.write_all(&chunk).await?;
                                    bytes_written_this_attempt += chunk.len() as u64;
                                    let _ = tx.send(chunk.len() as f64).await;
                                }
                                Ok(None) => break,
                                Err(e) => {
                                    if attempts >= 3 {
                                        return Err(crate::Error::from(
                                            ErrorKind::FetchError(e),
                                        ));
                                    }
                                    stream_failed = true;
                                    break;
                                }
                            }
                        }

                        if stream_failed {
                            // Undo progress we already reported for this failed
                            // attempt so the bar doesn't over-count on retry.
                            let _ = tx.send(-(bytes_written_this_attempt as f64)).await;
                            file.seek(SeekFrom::Start(start)).await?;
                            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                            continue;
                        }
                        break;
                    }
                    Err(e) => {
                        if attempts >= 3 {
                            return Err(crate::Error::from(
                                ErrorKind::FetchError(e),
                            ));
                        }
                        tokio::time::sleep(std::time::Duration::from_secs(1))
                            .await;
                    }
                }
            }
            drop(permit);
            Ok::<u64, crate::Error>(chunk_idx)
        }));
    }

    drop(tx);

    let mut current_bytes: u64 = state.chunks_completed.len() as u64 * CHUNK_SIZE;
    while let Some(bytes) = rx.recv().await {
        let _ = emit_loading(loading_bar, bytes, Some("Downloading Bedrock..."));
        if bytes > 0.0 {
            current_bytes = current_bytes.saturating_add(bytes as u64);
        } else if bytes < 0.0 {
            current_bytes = current_bytes.saturating_sub((-bytes) as u64);
        }
        if let (Some(rep), Some(det)) = (reporter, phase_details) {
            let _ = rep
                .update(
                    crate::install::InstallPhaseId::DownloadingMinecraft,
                    Some(crate::install::InstallProgress {
                        current: current_bytes,
                        total: total_size,
                        secondary: None,
                    }),
                    det.clone(),
                )
                .await;
        }
    }

    for task in tasks {
        match task.await.map_err(|e| crate::Error::from(ErrorKind::OtherError(format!("Task failed: {}", e))))? {
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
