use crate::state::{
    CacheBehaviour, CacheValueType, CachedEntry, Organization, Project,
    ProjectV3, SearchResults, SearchResultsV3, TeamMember, User, Version,
};

macro_rules! impl_cache_methods {
    ($(($variant:ident, $type:ty)),*) => {
        $(
            paste::paste! {
                #[tracing::instrument]
                pub async fn [<get_ $variant:snake>](
                    id: &str,
                    cache_behaviour: Option<CacheBehaviour>,
                ) -> crate::Result<Option<$type>>
                {
                    let state = crate::State::get().await?;
                    Ok(CachedEntry::[<get_ $variant:snake _many>](&[id], cache_behaviour, &state.pool, &state.api_semaphore).await?.into_iter().next())
                }

                #[tracing::instrument]
                pub async fn [<get_ $variant:snake _many>](
                    ids: &[&str],
                    cache_behaviour: Option<CacheBehaviour>,
                ) -> crate::Result<Vec<$type>>
                {
                    let state = crate::State::get().await?;
                    let entries =
                        CachedEntry::[<get_ $variant:snake _many>](ids, None, &state.pool, &state.api_semaphore).await?;

                    Ok(entries)
                }
            }
        )*
    }
}

impl_cache_methods!(
    (Project, Project),
    (ProjectV3, ProjectV3),
    (Version, Version),
    (User, User),
    (Team, Vec<TeamMember>),
    (Organization, Organization),
    (SearchResults, SearchResults),
    (SearchResultsV3, SearchResultsV3)
);

pub async fn purge_cache_types(
    cache_types: &[CacheValueType],
) -> crate::Result<()> {
    let state = crate::State::get().await?;
    CachedEntry::purge_cache_types(cache_types, &state.pool).await?;

    Ok(())
}

/// Get versions for a project (without changelogs for fast loading).
/// Uses the cache system with the ProjectVersions cache type.
#[tracing::instrument]
pub async fn get_project_versions(
    project_id: &str,
    cache_behaviour: Option<CacheBehaviour>,
) -> crate::Result<Option<Vec<Version>>> {
    let state = crate::State::get().await?;
    CachedEntry::get_project_versions(
        project_id,
        cache_behaviour,
        &state.pool,
        &state.api_semaphore,
    )
    .await
}

use serde::{Serialize, Deserialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CacheSizes {
    pub bedrock_packages: u64,
    pub java_runtimes: u64,
    pub http_cache: u64,
    pub total: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BedrockPackageInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_valid: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProfileStorageInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
}

fn dir_size(path: impl AsRef<Path>) -> u64 {
    let mut total = 0;
    if let Ok(dir) = std::fs::read_dir(path) {
        for entry in dir.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_dir() {
                    total += dir_size(entry.path());
                } else {
                    total += metadata.len();
                }
            }
        }
    }
    total
}

pub async fn get_cache_sizes() -> crate::Result<CacheSizes> {
    let state = crate::State::get().await?;
    let dirs = &state.directories;
    
    let bedrock_packages = dir_size(dirs.versions_dir());
    let java_runtimes = dir_size(dirs.java_versions_dir());
    let http_cache = dir_size(dirs.caches_dir());
    
    Ok(CacheSizes {
        bedrock_packages,
        java_runtimes,
        http_cache,
        total: bedrock_packages + java_runtimes + http_cache,
    })
}

pub async fn get_bedrock_packages() -> crate::Result<Vec<BedrockPackageInfo>> {
    let state = crate::State::get().await?;
    let versions_dir = state.directories.versions_dir();
    
    let mut packages = Vec::new();
    if let Ok(mut dir) = tokio::fs::read_dir(&versions_dir).await {
        while let Ok(Some(entry)) = dir.next_entry().await {
            let metadata = entry.metadata().await?;
            if metadata.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                let path = entry.path();
                
                // Check if directory has valid contents (e.g. at least one non-empty file or AppxManifest)
                let is_valid = path.join("AppxManifest.xml").exists() || path.join("bedrock_app.7z").exists() || path.join("AppxBlockMap.xml").exists();

                packages.push(BedrockPackageInfo {
                    name,
                    path: path.to_string_lossy().to_string(),
                    size: dir_size(&path),
                    is_valid,
                });
            }
        }
    }
    
    Ok(packages)
}

pub async fn remove_directory(path_str: String) -> crate::Result<()> {
    let path = std::path::PathBuf::from(path_str);
    let state = crate::State::get().await?;
    
    let versions_dir = state.directories.versions_dir();
    let java_versions_dir = state.directories.java_versions_dir();
    
    if path.starts_with(&versions_dir) || path.starts_with(&java_versions_dir) {
        tokio::fs::remove_dir_all(path).await?;
    }
    
    Ok(())
}

pub async fn get_profile_storage() -> crate::Result<Vec<ProfileStorageInfo>> {
    let state = crate::State::get().await?;
    let profiles = crate::api::profile::list().await?;
    
    let mut storage_info = Vec::new();
    for profile in profiles {
        let path = state.directories.profiles_dir().join(&profile.path);
        storage_info.push(ProfileStorageInfo {
            name: profile.name.clone(),
            path: profile.path.clone(),
            size: dir_size(&path),
        });
    }
    
    Ok(storage_info)
}
