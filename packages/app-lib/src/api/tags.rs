//! Theseus tag management interface
use crate::state::CachedEntry;
pub use crate::{
    State,
    state::{Category, DonationPlatform, GameVersion, Loader},
};

/// Get category tags
#[tracing::instrument]
pub async fn get_category_tags() -> crate::Result<Vec<Category>> {
    let state = State::get().await?;
    let categories =
        match CachedEntry::get_categories(None, &state.pool, &state.api_semaphore).await {
            Ok(Some(cats)) => cats,
            Ok(None) => return Err(crate::ErrorKind::NoValueFor("category tags".to_string()).into()),
            Err(e) => {
                std::fs::write("C:\\Users\\oskar\\Desktop\\bedr\\bedringh2\\get_categories_err.log", format!("SQL/Cache error: {:?}", e)).ok();
                return Err(e);
            }
        };

    Ok(categories)
}

/// Get report type tags
#[tracing::instrument]
pub async fn get_report_type_tags() -> crate::Result<Vec<String>> {
    let state = State::get().await?;
    let report_types =
        CachedEntry::get_report_types(None, &state.pool, &state.api_semaphore)
            .await?
            .ok_or_else(|| {
                crate::ErrorKind::NoValueFor("report type tags".to_string())
            })?;

    Ok(report_types)
}

/// Get loader tags
#[tracing::instrument]
pub async fn get_loader_tags() -> crate::Result<Vec<Loader>> {
    let state = State::get().await?;
    let loaders =
        match CachedEntry::get_loaders(None, &state.pool, &state.api_semaphore).await {
            Ok(Some(l)) => l,
            Ok(None) => return Err(crate::ErrorKind::NoValueFor("loader tags".to_string()).into()),
            Err(e) => {
                std::fs::write("C:\\Users\\oskar\\Desktop\\bedr\\bedringh2\\get_loaders_err.log", format!("SQL/Cache error: {:?}", e)).ok();
                return Err(e);
            }
        };

    Ok(loaders)
}

/// Get game version tags
#[tracing::instrument]
pub async fn get_game_version_tags() -> crate::Result<Vec<GameVersion>> {
    let state = State::get().await?;
    let game_versions =
        CachedEntry::get_game_versions(None, &state.pool, &state.api_semaphore)
            .await?
            .ok_or_else(|| {
                crate::ErrorKind::NoValueFor("game version tags".to_string())
            })?;

    Ok(game_versions)
}

/// Get donation platform tags
#[tracing::instrument]
pub async fn get_donation_platform_tags() -> crate::Result<Vec<DonationPlatform>>
{
    let state = State::get().await?;
    let donation_platforms = CachedEntry::get_donation_platforms(
        None,
        &state.pool,
        &state.api_semaphore,
    )
    .await?
    .ok_or_else(|| {
        crate::ErrorKind::NoValueFor("donation platform tags".to_string())
    })?;

    Ok(donation_platforms)
}
