//! Authentication flow interface
use crate::event::emit::{emit_loading, init_loading};
use crate::state::JavaVersion;
use crate::util::fetch::{fetch_advanced, fetch_json};
use dashmap::DashMap;
use reqwest::Method;
use serde::Deserialize;
use std::path::PathBuf;
use sysinfo::{MemoryRefreshKind, RefreshKind};

use crate::util::io;
use crate::util::jre::extract_java_version;
use crate::{
    LoadingBarType, State,
    util::jre::{self},
};

pub async fn get_java_versions() -> crate::Result<DashMap<u32, JavaVersion>> {
    let state = State::get().await?;

    JavaVersion::get_all(&state.pool).await
}

pub async fn set_java_version(java_version: JavaVersion) -> crate::Result<()> {
    let state = State::get().await?;
    java_version.upsert(&state.pool).await?;
    Ok(())
}

// Searches for jres on the system given a java version (ex: 1.8, 1.17, 1.18)
// Allow higher allows for versions higher than the given version to be returned ('at least')
pub async fn find_filtered_jres(
    java_version: Option<u32>,
) -> crate::Result<Vec<JavaVersion>> {
    let jres = jre::get_all_jre().await?;

    // Filter out JREs that are not 1.17 or higher
    Ok(if let Some(java_version) = java_version {
        jres.into_iter()
            .filter(|jre| {
                let jre_version = extract_java_version(&jre.version);
                if let Ok(jre_version) = jre_version {
                    jre_version == java_version
                } else {
                    false
                }
            })
            .collect()
    } else {
        jres
    })
}

pub async fn auto_install_java(java_version: u32) -> crate::Result<PathBuf> {
    let state = State::get().await?;

    let loading_bar = init_loading(
        LoadingBarType::JavaDownload {
            version: java_version,
        },
        100.0,
        "Downloading java version",
    )
    .await?;

    let download_url = match java_version {
        8 => "https://github.com/oskarlolpo/bedrock-repacker/releases/download/java-jre/zulu8.94.0.17-ca-jre8.0.492-win_x64.zip".to_string(),
        17 => "https://github.com/oskarlolpo/bedrock-repacker/releases/download/java-jre/zulu17.66.19-ca-jre17.0.19-win_x64.zip".to_string(),
        21 => "https://github.com/oskarlolpo/bedrock-repacker/releases/download/java-jre/zulu21.50.19-ca-jre21.0.11-win_x64.zip".to_string(),
        25 => "https://github.com/oskarlolpo/bedrock-repacker/releases/download/java-jre/zulu25.34.17-ca-jre25.0.3-win_x64.zip".to_string(),
        _ => return Err(crate::ErrorKind::LauncherError(format!("Unsupported Java version: {}", java_version)).into()),
    };

    let base_name = match java_version {
        8 => "zulu8.94.0.17-ca-jre8.0.492-win_x64",
        17 => "zulu17.66.19-ca-jre17.0.19-win_x64",
        21 => "zulu21.50.19-ca-jre21.0.11-win_x64",
        25 => "zulu25.34.17-ca-jre25.0.3-win_x64",
        _ => "",
    };

    emit_loading(&loading_bar, 10.0, Some("Downloading java version"))?;

    let file = fetch_advanced(
        Method::GET,
        &download_url,
        None,
        None,
        None,
        None,
        Some((&loading_bar, 80.0)),
        None,
        &state.fetch_semaphore,
        &state.pool,
    )
    .await?;

    let path = state.directories.java_versions_dir();

    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(file))
        .map_err(|_| {
            crate::Error::from(crate::ErrorKind::InputError(
                "Failed to read java zip".to_string(),
            ))
        })?;

    // removes the old installation of java
    if let Some(file) = archive.file_names().next()
        && let Some(dir) = file.split('/').next()
    {
        let path = path.join(dir);

        if path.exists() {
            io::remove_dir_all(path).await?;
        }
    }

    emit_loading(&loading_bar, 0.0, Some("Extracting java"))?;
    archive.extract(&path).map_err(|_| {
        crate::Error::from(crate::ErrorKind::InputError(
            "Failed to extract java zip".to_string(),
        ))
    })?;
    emit_loading(&loading_bar, 10.0, Some("Done extracting java"))?;
    let mut base_path = path.join(base_name);

    #[cfg(target_os = "macos")]
    {
        base_path = base_path
            .join("Contents")
            .join("Home")
            .join("bin")
            .join("java")
    }

    #[cfg(not(target_os = "macos"))]
    {
        base_path = base_path.join("bin").join(jre::JAVA_BIN)
    }

    Ok(base_path)
}

// Validates JRE at a given at a given path
pub async fn check_jre(path: PathBuf) -> crate::Result<JavaVersion> {
    jre::check_java_at_filepath(&path).await
}

// Test JRE at a given path
pub async fn test_jre(
    path: PathBuf,
    major_version: u32,
) -> crate::Result<bool> {
    let jre = match jre::check_java_at_filepath(&path).await {
        Ok(jre) => jre,
        Err(e) => {
            tracing::warn!("Invalid Java at {}: {e}", path.display());
            return Ok(false);
        }
    };
    let version = extract_java_version(&jre.version)?;
    tracing::info!(
        "Expected Java version {major_version}, and found {version} at {}",
        path.display()
    );
    Ok(version == major_version)
}

fn system_memory_bytes() -> u64 {
    sysinfo::System::new_with_specifics(
        RefreshKind::nothing()
            .with_memory(MemoryRefreshKind::nothing().with_ram()),
    )
    .total_memory()
}

/// Recommended default max heap (MiB) for new instances based on system RAM.
pub fn default_memory_max_mb() -> u32 {
    const BYTES_PER_GIB: u64 = 1024 * 1024 * 1024;
    let system_gib = system_memory_bytes() / BYTES_PER_GIB;

    if system_gib < 8 {
        1024 * 2
    } else if system_gib >= 24 {
        1024 * 6
    } else {
        1024 * 4
    }
}

// Gets maximum memory in KiB.
pub async fn get_max_memory() -> crate::Result<u64> {
    Ok(system_memory_bytes() / 1024)
}
