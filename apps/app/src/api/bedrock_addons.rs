use crate::api::Result;
use theseus::bedrock_addons::BedrockAddon;

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("bedrock-addons")
        .invoke_handler(tauri::generate_handler![
            fetch_bedrock_addons,
            list_bedrock_addons,
            check_bedrock_addon_updates,
            set_bedrock_addon_enabled,
            delete_bedrock_addon,
            install_bedrock_addon_from_file,
            search_bedrock_curseforge_addons,
            get_bedrock_curseforge_addon_files,
            get_bedrock_curseforge_addon,
            get_bedrock_curseforge_addon_description,
            download_and_install_bedrock_curseforge_addon,
            get_curseforge_minecraft_versions,
        ])
        .build()
}

#[tauri::command]
pub async fn get_curseforge_minecraft_versions() -> Result<Vec<String>> {
    Ok(theseus::bedrock_curseforge::get_curseforge_minecraft_versions().await?)
}

#[tauri::command]
pub async fn fetch_bedrock_addons(profile_path: String) -> Result<Vec<BedrockAddon>> {
    Ok(theseus::bedrock_addons::list_bedrock_addons(&profile_path).await?)
}

#[tauri::command]
pub async fn list_bedrock_addons(profile_path: String) -> Result<Vec<BedrockAddon>> {
    Ok(theseus::bedrock_addons::list_bedrock_addons(&profile_path).await?)
}

#[tauri::command]
pub async fn check_bedrock_addon_updates(profile_path: String) -> Result<Vec<BedrockAddon>> {
    Ok(theseus::bedrock_addons::check_bedrock_addon_updates(&profile_path).await?)
}

#[tauri::command]
pub async fn set_bedrock_addon_enabled(
    profile_path: String,
    kind: String,
    folder_name: String,
    enable: bool,
) -> Result<()> {
    Ok(theseus::bedrock_addons::set_bedrock_addon_enabled(&profile_path, &kind, &folder_name, enable).await?)
}

#[tauri::command]
pub async fn delete_bedrock_addon(profile_path: String, kind: String, folder_name: String) -> Result<()> {
    Ok(theseus::bedrock_addons::delete_bedrock_addon(&profile_path, &kind, &folder_name).await?)
}

#[tauri::command]
pub async fn install_bedrock_addon_from_file(profile_path: String, archive_path: String) -> Result<()> {
    Ok(theseus::bedrock_addons::install_bedrock_addon_from_file(&profile_path, &archive_path).await?)
}

#[tauri::command]
pub async fn search_bedrock_curseforge_addons(
    query: String,
    category_id: Option<i32>,
    class_id: Option<i32>,
    game_version: Option<String>,
    sort_field: Option<i32>,
    sort_order: Option<String>,
    index: Option<i32>,
    page_size: Option<i32>,
) -> Result<theseus::bedrock_curseforge::CurseForgeSearchResult> {
    Ok(theseus::bedrock_curseforge::search_addons(
        &query,
        category_id,
        class_id,
        game_version,
        sort_field,
        sort_order,
        index,
        page_size,
    )
    .await?)
}

#[tauri::command]
pub async fn get_bedrock_curseforge_addon(mod_id: i32) -> Result<theseus::bedrock_curseforge::CurseForgeMod> {
    Ok(theseus::bedrock_curseforge::get_addon_details(mod_id).await?)
}

#[tauri::command]
pub async fn get_bedrock_curseforge_addon_description(mod_id: i32) -> Result<String> {
    Ok(theseus::bedrock_curseforge::get_addon_description(mod_id).await?)
}

#[tauri::command]
pub async fn get_bedrock_curseforge_addon_files(mod_id: i32) -> Result<Vec<theseus::bedrock_curseforge::CurseForgeFile>> {
    Ok(theseus::bedrock_curseforge::get_addon_files(mod_id).await?)
}

#[tauri::command]
pub async fn download_and_install_bedrock_curseforge_addon(profile_path: String, download_url: String) -> Result<()> {
    let file_path = theseus::bedrock_curseforge::download_addon(&download_url).await?;
    theseus::bedrock_addons::install_bedrock_addon_from_file(&profile_path, &file_path).await?;
    // Cleanup downloaded file
    let _ = tokio::fs::remove_file(file_path).await;
    Ok(())
}
