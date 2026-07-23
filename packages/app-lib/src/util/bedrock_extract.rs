use crate::ErrorKind;
use crate::event::emit::{edit_loading, emit_loading};
use crate::event::{LoadingBarId, LoadingBarType};
use std::path::PathBuf;

pub async fn extract_bedrock_package(
    package_path: PathBuf,
    target_dir: PathBuf,
    loading_bar: &LoadingBarId,
    profile_name: &str,
    profile_path: &str,
) -> crate::Result<()> {
    if target_dir.join("AppxManifest.xml").exists() {
        return Ok(());
    }

    tokio::fs::create_dir_all(&target_dir).await?;

    let _ = edit_loading(
        loading_bar,
        LoadingBarType::MinecraftDownload {
            profile_name: profile_name.to_string(),
            profile_path: profile_path.to_string(),
        },
        100.0,
        "Распаковка пакета...",
    )
    .await;


    let ext = package_path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let is_msixvc = ext == "msixvc";
    let is_7z = ext == "7z" || ext == "001" || package_path.to_string_lossy().contains(".7z");

    if is_7z {
        extract_7z(package_path, target_dir.clone(), loading_bar).await?;
        
        // After 7z extraction, the archive might just contain a single msixvc or appx file.
        // If so, we need to extract that inner package too.
        let mut entries = tokio::fs::read_dir(&target_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.is_file() {
                let inner_ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                if inner_ext == "msixvc" {
                    let _ = emit_loading(
                        loading_bar,
                        0.0,
                        Some("Распаковка внутреннего GDK пакета..."),
                    );
                    extract_msixvc(path.clone(), target_dir.clone(), loading_bar).await?;
                    let _ = tokio::fs::remove_file(&path).await;
                } else if inner_ext == "appx" {
                    let _ = emit_loading(
                        loading_bar,
                        0.0,
                        Some("Распаковка внутреннего UWP пакета..."),
                    );
                    extract_zip(path.clone(), target_dir.clone(), loading_bar).await?;
                    let _ = tokio::fs::remove_file(&path).await;
                }
            }
        }
    } else if is_msixvc {
        extract_msixvc(package_path, target_dir, loading_bar).await?;
    } else {
        extract_zip(package_path, target_dir, loading_bar).await?;
    }

    Ok(())
}

async fn extract_zip(
    package_path: PathBuf,
    target_dir: PathBuf,
    loading_bar: &LoadingBarId,
) -> crate::Result<()> {
    let loading_bar = loading_bar.clone();

    tokio::task::spawn_blocking(move || -> crate::Result<()> {
        let file = std::fs::File::open(&package_path)?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| {
            crate::Error::from(ErrorKind::OtherError(e.to_string()))
        })?;

        let total_files = archive.len();
        let mut previous_pct = 0.0;
        for i in 0..total_files {
            let mut file = archive.by_index(i).map_err(|e| {
                crate::Error::from(ErrorKind::OtherError(e.to_string()))
            })?;

            let outpath = match file.enclosed_name() {
                Some(path) => target_dir.join(path),
                None => continue,
            };

            if (*file.name()).ends_with('/') {
                std::fs::create_dir_all(&outpath)?;
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        std::fs::create_dir_all(p)?;
                    }
                }
                let mut outfile = std::fs::File::create(&outpath)?;
                std::io::copy(&mut file, &mut outfile)?;
            }

            if i % 100 == 0 {
                let pct = (i as f64 / total_files as f64) * 100.0;
                let inc = pct - previous_pct;
                previous_pct = pct;
                let _ = emit_loading(
                    &loading_bar,
                    inc,
                    Some("Распаковка архива..."),
                );
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| crate::Error::from(ErrorKind::OtherError(format!("Task joined error: {}", e))))?
}

async fn extract_msixvc(
    package_path: PathBuf,
    target_dir: PathBuf,
    loading_bar: &LoadingBarId,
) -> crate::Result<()> {
    let loading_bar = loading_bar.clone();

    tokio::task::spawn_blocking(move || -> crate::Result<()> {
        let _ = emit_loading(
            &loading_bar,
            0.0,
            Some("Чтение структуры GDK пакета..."),
        );

        use crate::util::gdk::stream::MsiXVDStream;

        let mut stream = match MsiXVDStream::new(&package_path) {
            Ok(s) => s,
            Err(e) => {
                return Err(crate::Error::from(ErrorKind::OtherError(
                    format!("Ошибка парсинга MSIXVC: {}", e),
                )));
            }
        };

        if let Err(e) = stream.extract_to(&target_dir, &loading_bar) {
            return Err(crate::Error::from(ErrorKind::OtherError(format!(
                "Ошибка распаковки GDK: {}",
                e
            ))));
        }

        Ok(())
    })
    .await
    .map_err(|e| crate::Error::from(ErrorKind::OtherError(format!("Task joined error: {}", e))))?
}


async fn extract_7z(
    package_path: PathBuf,
    target_dir: PathBuf,
    loading_bar: &LoadingBarId,
) -> crate::Result<()> {
    let loading_bar = loading_bar.clone();

    tokio::task::spawn_blocking(move || -> crate::Result<()> {
        let _ = emit_loading(
            &loading_bar,
            0.0,
            Some("Распаковка 7z архива..."),
        );

        let mut extracted_size = 0u64;
        let mut emit_counter = 0;
        let mut previous_pct = 0.0;
        let assumed_total_size = 1_500_000_000u64; // ~1.5 GB uncompressed

        sevenz_rust::decompress_file_with_extract_fn(&package_path, &target_dir, |entry, reader, dest| {
            extracted_size += entry.size();
            emit_counter += 1;
            
            if emit_counter % 50 == 0 {
                let mut pct = (extracted_size as f64 / assumed_total_size as f64) * 100.0;
                if pct > 99.0 { pct = 99.0; }
                let inc = pct - previous_pct;
                previous_pct = pct;
                
                let _ = emit_loading(
                    &loading_bar,
                    inc,
                    Some("Распаковка 7z архива..."),
                );
            }
            sevenz_rust::default_entry_extract_fn(entry, reader, dest)
        }).map_err(|e| {
            crate::Error::from(ErrorKind::OtherError(format!("Failed to extract 7z archive: {}", e)))
        })?;

        Ok(())
    })
    .await
    .map_err(|e| crate::Error::from(ErrorKind::OtherError(format!("Task joined error: {}", e))))?
}

