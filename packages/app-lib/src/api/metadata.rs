use crate::State;
use crate::state::CachedEntry;
pub use daedalus::minecraft::VersionManifest;
pub use daedalus::modded::Manifest;

#[tracing::instrument]
pub async fn get_minecraft_versions() -> crate::Result<VersionManifest> {
    let state = State::get().await?;
    let minecraft_versions = match CachedEntry::get_minecraft_manifest(
        None,
        &state.pool,
        &state.api_semaphore,
    )
    .await
    {
        Ok(Some(res)) => res,
        Ok(None) => {
            return Err(crate::ErrorKind::NoValueFor(
                "minecraft versions".to_string(),
            )
            .into());
        }
        Err(e) => {
            tracing::warn!(
                "Fallback to offline cache for minecraft versions: {}",
                e
            );
            CachedEntry::get_minecraft_manifest(
                Some(crate::state::CacheBehaviour::StaleWhileRevalidateSkipOffline),
                &state.pool,
                &state.api_semaphore,
            ).await?
            .ok_or_else(|| {
                crate::ErrorKind::NoValueFor("minecraft versions".to_string())
            })?
        }
    };

    Ok(minecraft_versions)
}

// #[tracing::instrument]
pub async fn get_loader_versions(loader: &str) -> crate::Result<Manifest> {
    if loader == "bedrock" {
        let bedrock_versions =
            crate::api::bedrock::fetch_bedrock_versions().await?;
        let mut game_versions = Vec::new();
        for v in bedrock_versions {
            game_versions.push(daedalus::modded::Version {
                id: v.version,
                stable: !v.is_preview,
                loaders: vec![daedalus::modded::LoaderVersion {
                    id: "bedrock".to_string(),
                    url: v.identifier,
                    stable: !v.is_preview,
                }],
            });
        }
        return Ok(Manifest { game_versions });
    }

    let state = State::get().await?;
    let loaders = match CachedEntry::get_loader_manifest(
        loader,
        None,
        &state.pool,
        &state.api_semaphore,
    )
    .await
    {
        Ok(Some(res)) => res,
        Ok(None) => {
            return Err(crate::ErrorKind::NoValueFor(format!(
                "{loader} loader versions"
            ))
            .into());
        }
        Err(e) => {
            tracing::warn!(
                "Fallback to offline cache for loader versions: {}",
                e
            );
            CachedEntry::get_loader_manifest(
                loader,
                Some(crate::state::CacheBehaviour::StaleWhileRevalidateSkipOffline),
                &state.pool,
                &state.api_semaphore,
            ).await?
            .ok_or_else(|| {
                crate::ErrorKind::NoValueFor(format!("{loader} loader versions"))
            })?
        }
    };

    Ok(loaders.manifest)
}
