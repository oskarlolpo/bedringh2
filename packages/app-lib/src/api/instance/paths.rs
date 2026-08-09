use crate::state::State;
use crate::util::io;
use std::path::PathBuf;

#[tracing::instrument]
pub async fn get_full_path(instance_id: &str) -> crate::Result<PathBuf> {
    let state = State::get().await?;
    let path =
        crate::state::instances::adapters::sqlite::instance_rows::get_instance_path_by_id(
            instance_id,
            &state.pool,
        )
        .await?
        .ok_or_else(|| {
            crate::ErrorKind::InputError("Unknown instance".to_string())
        })?;

    Ok(io::canonicalize(
        state.directories.instances_dir().join(path),
    )?)
}

#[tracing::instrument]
pub async fn get_mod_full_path(
    instance_id: &str,
    project_path: &str,
) -> crate::Result<PathBuf> {
    Ok(get_full_path(instance_id).await?.join(project_path))
}

/// Get an instance's full path in the filesystem from its *relative* path
/// (the `path` field stored on the instance / used by the frontend).
///
/// This mirrors the legacy `profile::get_full_path` behaviour that the
/// Bedrock code relies on: it joins the instances dir with the relative path.
#[tracing::instrument]
pub async fn get_full_path_by_path(path: &str) -> crate::Result<PathBuf> {
    let state = State::get().await?;
    let instances_dir = state.directories.instances_dir();

    let full_path = io::canonicalize(instances_dir.join(path))?;
    Ok(full_path)
}
