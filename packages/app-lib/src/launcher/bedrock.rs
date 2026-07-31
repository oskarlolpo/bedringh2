use crate::State;
use crate::api::profile::get_full_path;
use crate::error::{ErrorKind, Result};
use crate::state::{ProcessMetadata, Profile};
use std::os::windows::fs::MetadataExt;
use std::path::PathBuf;
use tokio::fs;
use tokio::process::Command;
use crate::state::emit_legacy_log;

const BEDROCK_UWP_FAMILY: &str = "Microsoft.MinecraftUWP_8wekyb3d8bbwe";
const BEDROCK_PREVIEW_FAMILY: &str =
    "Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe";

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BedrockInstallationType {
    Uwp,
    UwpPreview,
    Gdk,
    GdkPreview,
}

impl BedrockInstallationType {
    pub fn package_family(&self) -> &'static str {
        match self {
            Self::Uwp | Self::Gdk => BEDROCK_UWP_FAMILY,
            Self::UwpPreview | Self::GdkPreview => BEDROCK_PREVIEW_FAMILY,
        }
    }

    pub fn is_preview(&self) -> bool {
        matches!(self, Self::UwpPreview | Self::GdkPreview)
    }

    pub fn is_gdk(&self) -> bool {
        matches!(self, Self::Gdk | Self::GdkPreview)
    }
}

async fn get_bedrock_target_dir(
    install_type: BedrockInstallationType,
) -> Result<PathBuf> {
    if install_type.is_gdk() {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| {
            let mut path = dirs::home_dir().unwrap();
            path.push("AppData");
            path.push("Roaming");
            path.to_string_lossy().into_owned()
        });

        let infix = if install_type.is_preview() {
            "Minecraft Bedrock Preview"
        } else {
            "Minecraft Bedrock"
        };

        let users_dir = PathBuf::from(appdata).join(infix).join("Users");
        if !users_dir.exists() {
            fs::create_dir_all(&users_dir).await?;
        }

        // For GDK, there's usually a user-specific folder with a UID.
        // We'll just find the first directory inside "Users" or default to "Default"
        let mut entries = fs::read_dir(&users_dir).await?;
        let mut user_id_folder = "Default".to_string();
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    user_id_folder = name.to_string();
                    break;
                }
            }
        }

        let gdk_games_dir = users_dir.join(&user_id_folder).join("games");
        if !gdk_games_dir.exists() {
            fs::create_dir_all(&gdk_games_dir).await?;
        }
        Ok(gdk_games_dir)
    } else {
        let local_appdata =
            std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
                let mut path = dirs::home_dir().unwrap();
                path.push("AppData");
                path.push("Local");
                path.to_string_lossy().into_owned()
            });

        let uwp_games_dir = PathBuf::from(local_appdata)
            .join("Packages")
            .join(install_type.package_family())
            .join("LocalState")
            .join("games");

        if !uwp_games_dir.exists() {
            fs::create_dir_all(&uwp_games_dir).await?;
        }
        Ok(uwp_games_dir)
    }
}

struct BedrockJunctionGuard {
    profile_path: String,
    mojang_dir: PathBuf,
    backup_dir: PathBuf,
}

impl Drop for BedrockJunctionGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir(&self.mojang_dir);
        if self.backup_dir.exists() {
            let _ = std::fs::rename(&self.backup_dir, &self.mojang_dir);
        }
        crate::state::emit_legacy_log(&self.profile_path, "Восстановление оригинальных системных сохранений...");
    }
}

pub async fn launch_bedrock(profile: &Profile) -> Result<ProcessMetadata> {
    let state = State::get().await?;
    let instance_path = get_full_path(&profile.path).await?;
    let versions_dir = state
        .directories
        .caches_dir()
        .join("versions")
        .join(format!("bedrock_{}", profile.game_version));

    let is_gdk_unpacked = versions_dir.join("MicrosoftGame.config").exists();

    let install_type =
        if profile.game_version.to_lowercase().contains("preview")
            || profile.game_version.to_lowercase().contains("beta")
        {
            if is_gdk_unpacked || profile.game_version.to_lowercase().contains("gdk") {
                BedrockInstallationType::GdkPreview
            } else {
                BedrockInstallationType::UwpPreview
            }
        } else {
            if is_gdk_unpacked || profile.game_version.to_lowercase().contains("gdk") {
                BedrockInstallationType::Gdk
            } else {
                BedrockInstallationType::Uwp
            }
        };

    let manifest_path = versions_dir.join("AppxManifest.xml");
    let mut pkg_name = if install_type.is_preview() {
        "Microsoft.MinecraftWindowsBeta".to_string()
    } else {
        "Microsoft.MinecraftUWP".to_string()
    };

    if manifest_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&manifest_path) {
            if let Some(start) = content.find("<Identity Name=\"") {
                let rest = &content[start + 16..];
                if let Some(end) = rest.find('"') {
                    pkg_name = rest[..end].to_string();
                }
            }
        }
    }

    let pfn_to_use = format!("{}_8wekyb3d8bbwe", pkg_name);

    let exe_path = versions_dir.join("Minecraft.Windows.exe");

    let is_custom_unpacked = !is_gdk_unpacked && std::fs::read_dir(&versions_dir)
        .map(|mut dir| dir.any(|entry| {
            if let Ok(entry) = entry {
                entry.file_name() == "AppxManifest.xml"
            } else {
                false
            }
        }))
        .unwrap_or(false);

    let exe_path_to_inject: Option<PathBuf> = if is_gdk_unpacked && !is_custom_unpacked && exe_path.exists() {
        Some(exe_path.clone())
    } else {
        None
    };

    if is_custom_unpacked {
        emit_legacy_log(&profile.path, "Проверка установленной версии UWP (Hot-Swap)...");

        let output = std::process::Command::new("powershell")
            .creation_flags(0x08000000)
            .args(&[
                "-NoProfile",
                "-Command",
                &format!("$pkg = Get-AppxPackage -Name {}; if ($pkg) {{ $pkg.InstallLocation }} else {{ 'None' }}", pkg_name)
            ])
            .output()?;
        let install_location = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let expected_location = versions_dir.to_str().unwrap_or("").to_string();

        if install_location.to_lowercase().trim_end_matches('\\') != expected_location.to_lowercase().trim_end_matches('\\') {
            if install_location != "None" {
                emit_legacy_log(&profile.path, "Удаление предыдущего UWP пакета (Hot-Swap)...");
                let _ = std::process::Command::new("powershell")
                    .creation_flags(0x08000000)
                    .args(&[
                        "-NoProfile",
                        "-Command",
                        &format!("Get-AppxPackage -Name {} | Remove-AppxPackage", pkg_name)
                    ])
                    .output();
            }

            emit_legacy_log(&profile.path, "Регистрация распакованного UWP пакета (Hot-Swap)...");
            let install_output = std::process::Command::new("powershell")
                .creation_flags(0x08000000)
                .args(&[
                    "-NoProfile",
                    "-Command",
                    &format!("Add-AppxPackage -Register '{}' -ForceApplicationShutdown", manifest_path.display()),
                ])
                .output()?;

            if !install_output.status.success() {
                let err_msg = String::from_utf8_lossy(&install_output.stderr);
                emit_legacy_log(&profile.path, &format!("Ошибка регистрации: {}", err_msg));
            }
        } else {
            emit_legacy_log(&profile.path, "UWP пакет уже зарегистрирован на текущую сборку.");
        }
    }

    let instance_mojang = instance_path.join("com.mojang");

    if !instance_mojang.exists() {
        fs::create_dir_all(&instance_mojang).await?;
    }

    emit_legacy_log(&profile.path, "Granting application package access permissions to profile data...");
    let _ = crate::launcher::inject::grant_all_application_packages_access(&instance_mojang).await;

    let target_games_dir = get_bedrock_target_dir(install_type).await?;
    let _ = crate::launcher::inject::grant_all_application_packages_access(&target_games_dir).await;

    if let Some(ref exe_path) = exe_path_to_inject {
        let exe_dir = exe_path.parent().unwrap();
        let local_data_root = exe_dir.join("Minecraft Bedrock");
        if !local_data_root.exists() {
            let _ = fs::create_dir_all(&local_data_root).await;
        }
        let local_games_dir = local_data_root.join("LocalState").join("games");
        if !local_games_dir.exists() {
            let _ = fs::create_dir_all(&local_games_dir).await;
        }
        let _ = crate::launcher::inject::grant_all_application_packages_access(&local_games_dir).await;
        let local_mojang = local_games_dir.join("com.mojang");
        if local_mojang.exists() {
            let meta: std::fs::Metadata = fs::symlink_metadata(&local_mojang).await?;
            let is_reparse_point = (meta.file_attributes() & 0x00000400) != 0;
            if is_reparse_point {
                let _ = fs::remove_dir(&local_mojang).await;
            } else {
                let _ = fs::remove_dir_all(&local_mojang).await;
            }
        }
        use std::os::windows::process::CommandExt;
        let local_junction_output = std::process::Command::new("cmd")
            .creation_flags(0x08000000)
            .arg("/c")
            .raw_arg(format!("mklink /J \"{}\" \"{}\"", local_mojang.display(), instance_mojang.display()))
            .output();

        match local_junction_output {
            Ok(out) if out.status.success() => {
                emit_legacy_log(&profile.path, &format!("Local GDK data junction mounted: {}", local_mojang.display()));
            }
            Ok(out) => {
                let err_msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
                let out_msg = String::from_utf8_lossy(&out.stdout).trim().to_string();
                emit_legacy_log(
                    &profile.path,
                    &format!(
                        "WARNING: Failed to mount local GDK data junction ({}): {} {}. Installed content may not be visible in-game.",
                        local_mojang.display(), err_msg, out_msg
                    ),
                );
            }
            Err(e) => {
                emit_legacy_log(
                    &profile.path,
                    &format!(
                        "WARNING: Failed to run mklink for local GDK data junction ({}): {}. Installed content may not be visible in-game.",
                        local_mojang.display(), e
                    ),
                );
            }
        }

        // Verify the junction actually resolves to our instance folder before proceeding;
        // if it doesn't, retry once after a fresh cleanup pass.
        let junction_ok = std::fs::symlink_metadata(&local_mojang)
            .map(|m| (m.file_attributes() & 0x00000400) != 0)
            .unwrap_or(false);
        if !junction_ok {
            emit_legacy_log(
                &profile.path,
                &format!(
                    "WARNING: Local GDK data junction verification failed at {} - retrying once.",
                    local_mojang.display()
                ),
            );
            let _ = fs::remove_dir_all(&local_mojang).await;
            let retry_output = std::process::Command::new("cmd")
                .creation_flags(0x08000000)
                .arg("/c")
                .raw_arg(format!("mklink /J \"{}\" \"{}\"", local_mojang.display(), instance_mojang.display()))
                .output();
            match retry_output {
                Ok(out) if out.status.success() => {
                    emit_legacy_log(&profile.path, "Local GDK data junction mounted on retry.");
                }
                _ => {
                    emit_legacy_log(
                        &profile.path,
                        "ERROR: Local GDK data junction could not be mounted after retry. Installed content will NOT appear in-game for this launch.",
                    );
                }
            }
        }
    }

    let mojang_dir = target_games_dir.join("com.mojang");
    let mut actual_backup_dir = target_games_dir.join("com.mojang.backup");

    if !target_games_dir.exists() {
        fs::create_dir_all(&target_games_dir).await?;
    }

    if mojang_dir.exists() {
        let meta: std::fs::Metadata = fs::symlink_metadata(&mojang_dir).await?;
        let is_reparse_point = (meta.file_attributes() & 0x00000400) != 0;

        if is_reparse_point {
            fs::remove_dir(&mojang_dir).await?;
        } else {
            if actual_backup_dir.exists() {
                let ts = chrono::Utc::now().timestamp();
                actual_backup_dir = target_games_dir.join(format!("com.mojang.backup_{}", ts));
            }
            match fs::rename(&mojang_dir, &actual_backup_dir).await {
                Ok(_) => {}
                Err(e) => {
                    return Err(ErrorKind::LauncherError(format!(
                        "Не удалось создать бэкап оригинальной папки com.mojang: {}", e
                    ))
                    .into());
                }
            }
        }
    }

    emit_legacy_log(&profile.path, "Синхронизация скина для Bedrock...");
    let _ = sync_bedrock_custom_skin_pack(&instance_mojang).await;

    emit_legacy_log(&profile.path, "Монтирование изолированной файловой системы профиля...");
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("cmd")
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .arg("/c")
        .raw_arg(format!("mklink /J \"{}\" \"{}\"", mojang_dir.display(), instance_mojang.display()))
        .output()?;

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let out_msg = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(
            ErrorKind::LauncherError(format!("Не удалось примонтировать файловую систему профиля: {} {}", err_msg, out_msg)).into()
        );
    }
    let _ = crate::launcher::inject::grant_all_application_packages_access(&mojang_dir).await;

    let junction_guard = BedrockJunctionGuard {
        profile_path: profile.path.clone(),
        mojang_dir,
        backup_dir: actual_backup_dir,
    };

    crate::api::profile::edit(&profile.path, |prof| {
        prof.last_played = Some(chrono::Utc::now());
        async { Ok(()) }
    })
    .await?;

    let main_class_keep_alive = tempfile::tempdir()?;
    let rpc_server = crate::util::rpc::RpcServerBuilder::new().launch().await?;

    emit_legacy_log(&profile.path, "Starting Minecraft Bedrock launch sequence...");

    let target_exe_path = if exe_path.exists() {
        Some(exe_path.clone())
    } else {
        exe_path_to_inject
    };

    if let Some(exe_path) = target_exe_path {
        let exe_dir = exe_path.parent().unwrap();
        // Deploy xgameruntime.dll and Store DLL unconditionally for all launches so Gaming Runtime is available
        let xgameruntime_path = exe_dir.join("xgameruntime.dll");
        if !xgameruntime_path.exists() {
            emit_legacy_log(&profile.path, "Downloading xgameruntime.dll from GitHub releases...");
            if let Err(e) = crate::api::bedrock_preflight::download_fallback_dll("xgameruntime.dll", &xgameruntime_path).await {
                tracing::error!("Failed to download xgameruntime.dll: {}", e);
            }
        }
        let _ = crate::launcher::inject::grant_all_application_packages_access(&xgameruntime_path).await;

        let store_dll_path = exe_dir.join("Windows.ApplicationModel.Store_x64.dll");
        let store_dll_alias = exe_dir.join("Windows.ApplicationModel.Store.dll");
        if !store_dll_path.exists() {
            emit_legacy_log(&profile.path, "Downloading Windows.ApplicationModel.Store_x64.dll from GitHub releases...");
            if let Err(e) = crate::api::bedrock_preflight::download_fallback_dll("Windows.ApplicationModel.Store_x64.dll", &store_dll_path).await {
                tracing::error!("Failed to download Windows.ApplicationModel.Store_x64.dll: {}", e);
            }
        }
        let _ = tokio::fs::copy(&store_dll_path, &store_dll_alias).await;
        let _ = crate::launcher::inject::grant_all_application_packages_access(&store_dll_path).await;
        let _ = crate::launcher::inject::grant_all_application_packages_access(&store_dll_alias).await;

        // BLoader is required for all launches unconditionally
        let injector_name = "BLoader.dll";
        let injector_target_path = exe_dir.join(injector_name);

        if !injector_target_path.exists() {
            emit_legacy_log(&profile.path, "Downloading BLoader.dll from GitHub releases...");
            if let Err(e) = crate::api::bedrock_preflight::download_fallback_dll("BLoader.dll", &injector_target_path).await {
                tracing::error!("Failed to download BLoader.dll: {}", e);
            }
        }
        let _ = crate::launcher::inject::grant_all_application_packages_access(&injector_target_path).await;

        // Apply permissions required for game to run outside AppContainer
        emit_legacy_log(&profile.path, "Granting application package access permissions...");
        let local_data_root = exe_dir.join("Minecraft Bedrock");
        let _ = crate::launcher::inject::grant_all_application_packages_access(&local_data_root).await;
        let _ = crate::launcher::inject::grant_all_application_packages_access(exe_dir).await;

        if let Err(e) = crate::launcher::pe::ensure_backup(&exe_path) {
            tracing::warn!("Failed to create exe backup: {}", e);
        }

        if crate::launcher::pe::is_file_patched(&exe_path) {
            tracing::info!("PE already patched, skipping.");
            emit_legacy_log(&profile.path, "Minecraft.Windows.exe is already PE-patched.");
        } else {
            emit_legacy_log(&profile.path, "Patching Minecraft.Windows.exe PE to load BLoader.dll...");
            let _ = crate::launcher::pe::restore_original_pe(&exe_path);
            
            if let Ok(metadata) = std::fs::metadata(&exe_path) {
                let mut perms = metadata.permissions();
                if perms.readonly() {
                    #[allow(clippy::permissions_set_readonly_false)]
                    perms.set_readonly(false);
                    let _ = std::fs::set_permissions(&exe_path, perms);
                }
            }
            
            crate::launcher::pe::inject_dll_import(&exe_path, injector_name, None)
                .map_err(|e| ErrorKind::LauncherError(format!("PE modification failed: {}", e)))?;
            emit_legacy_log(&profile.path, "PE patching successful.");
        }

        // Check if Bedrock Unlocker for GDK is enabled in settings
        let settings = crate::state::Settings::get(&state.pool).await?;
        let gdk_unlocker_enabled = settings.feature_flags
            .get(&crate::state::FeatureFlag::BedrockUnlockerGdk)
            .copied()
            .unwrap_or(false);

        let gdk_unlocker_files = ["winmm.dll", "OnlineFix64.dll", "dlllist.txt", "OnlineFix.ini", "Windows.ApplicationModel.Store_x64.dll"];

        let mods_list: Vec<String> = Vec::new();

        if gdk_unlocker_enabled {
            emit_legacy_log(&profile.path, "Applying GDK Unlocker file changes (Enable)...");
            for file_name in &gdk_unlocker_files {
                let dest = exe_dir.join(file_name);
                if !dest.exists() {
                    emit_legacy_log(&profile.path, &format!("Downloading {} from GitHub releases...", file_name));
                    if let Err(e) = crate::api::bedrock_preflight::download_fallback_dll(file_name, &dest).await {
                        tracing::warn!("Failed to download GDK unlocker file {}: {}", file_name, e);
                    }
                }
            }
            // Re-apply permissions to newly downloaded unlocker files
            let _ = crate::launcher::inject::grant_all_application_packages_access(exe_dir).await;
        } else {
            let files_to_remove = ["winmm.dll", "OnlineFix64.dll", "dlllist.txt", "OnlineFix.ini", "winmm.dll.old", "OnlineFix64.dll.old"];
            for f in &files_to_remove {
                let dest = exe_dir.join(f);
                if dest.exists() {
                    let _ = fs::remove_file(&dest).await;
                }
            }
        }

        let config_json = serde_json::json!({
            "disable_mod_loading": false,
            "enable_dx11": false,
            "mods": mods_list
        });
        let config_str = serde_json::to_string_pretty(&config_json)?;
        fs::write(exe_dir.join("config.json"), &config_str).await?;
        fs::write(exe_dir.join("preloader.json"), &config_str).await?;

        // Use direct execution to capture stdout/stderr through pipes
        let exe_path_str = exe_path.to_str().unwrap().to_string();

        emit_legacy_log(&profile.path, "Spawning Minecraft.Windows.exe process...");
        let mut command = Command::new(&exe_path_str);
        if let Some(parent) = exe_path.parent() {
            command.current_dir(parent);
        }

        let keep_alive: Vec<Box<dyn std::any::Any + Send + Sync>> = vec![
            Box::new(main_class_keep_alive),
            Box::new(junction_guard),
        ];
        
        let process = state
            .process_manager
            .insert_new_process(
                &profile.path,
                command,
                None,
                state.directories.profile_logs_dir(&profile.path),
                false,
                keep_alive,
                rpc_server,
                async |metadata, _| {
                    emit_legacy_log(&metadata.profile_path, "Minecraft.Windows.exe successfully launched");
                    Ok(())
                },
            )
            .await?;

        Ok(process)
    } else {
        // Read the AppId from AppxManifest.xml in the versions_dir
        let manifest_path = versions_dir.join("AppxManifest.xml");
        let app_id = if manifest_path.exists() {
            let content = std::fs::read_to_string(&manifest_path).unwrap_or_default();
            // Extract Id="..." from first <Application ...> tag
            content
                .lines()
                .find_map(|line| {
                    if line.contains("<Application ") {
                        let start = line.find("Id=\"")? + 4;
                        let rest = &line[start..];
                        let end = rest.find('"')?;
                        Some(rest[..end].to_string())
                    } else {
                        None
                    }
                })
                .unwrap_or_else(|| "App".to_string())
        } else {
            "App".to_string()
        };

        // Check UWP Unlocker feature flag
        let settings = crate::state::Settings::get(&state.pool).await?;
        let uwp_unlocker_enabled = settings.feature_flags
            .get(&crate::state::FeatureFlag::BedrockUnlockerUwp)
            .copied()
            .unwrap_or(false);

        let system32_dll = "C:\\Windows\\System32\\Windows.ApplicationModel.Store.dll";
        let cracked_size: u64 = 2260832;
        let current_size = std::fs::metadata(system32_dll).map(|m| m.len()).unwrap_or(0);
        let is_patched = current_size == cracked_size;

        if is_patched != uwp_unlocker_enabled {
            emit_legacy_log(&profile.path, "UWP Bedrock Unlocker: patch state mismatch, requesting elevation...");

            let temp_dir = std::env::temp_dir().join("bedrin_uwp_unlocker");
            let _ = std::fs::create_dir_all(temp_dir.join("System32"));
            let _ = std::fs::create_dir_all(temp_dir.join("SysWOW64"));
            
            let _ = std::fs::write(temp_dir.join("patch.ps1"), include_bytes!("../../assets/unlocker/uwp/patch.ps1"));
            let _ = std::fs::write(temp_dir.join("System32/Windows.ApplicationModel.Store.dll"), include_bytes!("../../assets/unlocker/uwp/System32/Windows.ApplicationModel.Store.dll"));
            let _ = std::fs::write(temp_dir.join("SysWOW64/Windows.ApplicationModel.Store.dll"), include_bytes!("../../assets/unlocker/uwp/SysWOW64/Windows.ApplicationModel.Store.dll"));
            
            let script_path = temp_dir.join("patch.ps1");
            let work_dir = temp_dir.to_str().unwrap();
            let action = if uwp_unlocker_enabled { "Enable" } else { "Disable" };

            let status = Command::new("powershell")
                .arg("-NoProfile")
                .arg("-WindowStyle").arg("Hidden")
                .arg("-Command")
                .arg(&format!("Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','{}','-Action','{}','-WorkDir','{}'", script_path.display(), action, work_dir))
                .creation_flags(0x08000000)
                .status().await;

            if let Ok(st) = status {
                if st.success() {
                    emit_legacy_log(&profile.path, "UWP Bedrock Unlocker: successfully applied patch.");
                } else {
                    emit_legacy_log(&profile.path, "UWP Bedrock Unlocker: UAC prompt declined or script failed. Disabling UWP unlocker.");
                    let mut updated_settings = settings.clone();
                    updated_settings.feature_flags.insert(crate::state::FeatureFlag::BedrockUnlockerUwp, false);
                    let _ = updated_settings.update(&state.pool).await;
                }
            } else {
                emit_legacy_log(&profile.path, "UWP Bedrock Unlocker: patch process failed to spawn. Disabling UWP unlocker.");
                let mut updated_settings = settings.clone();
                updated_settings.feature_flags.insert(crate::state::FeatureFlag::BedrockUnlockerUwp, false);
                let _ = updated_settings.update(&state.pool).await;
            }
        }

        let launch_target = format!("{}!{}", pfn_to_use, app_id);
        emit_legacy_log(&profile.path, &format!("Launching UWP via shell:appsFolder\\{}", launch_target));

        let ps_script = format!(
            "Write-Output 'Starting Bedrock UWP via shell:appsFolder\\{0}'; \
            Start-Process 'shell:appsFolder\\{0}'; \
            $timeout = 60; \
            while ($timeout -gt 0) {{ \
                $p = Get-Process -Name 'GameLaunchHelper','Minecraft.Windows','Minecraft.UWP','MinecraftUWP','Minecraft' -ErrorAction SilentlyContinue; \
                if ($p) {{ Write-Output ('Found Bedrock process(es) with PID(s): ' + ($p.Id -join ', ')); break }}; \
                Write-Output 'Waiting for Bedrock to launch... (' + $timeout + 's left)'; \
                Start-Sleep -Seconds 1; $timeout-- \
            }}; \
            if ($timeout -eq 0) {{ Write-Output 'ERROR: Bedrock process did not start within 60 seconds!' }}; \
            Write-Output 'Monitoring Bedrock process...'; \
            while (Get-Process -Name 'GameLaunchHelper','Minecraft.Windows','Minecraft.UWP','MinecraftUWP','Minecraft' -ErrorAction SilentlyContinue) {{ \
                Start-Sleep -Seconds 2 \
            }}; \
            Write-Output 'Bedrock process exited.'",
            launch_target
        );

        let mut command = Command::new("powershell");
        command.args(&["-WindowStyle", "Hidden", "-Command", &ps_script]);
        emit_legacy_log(&profile.path, &format!("Launching system UWP application: {}", pfn_to_use));

        let process = state
            .process_manager
            .insert_new_process(
                &profile.path,
                command,
                None,
                state.directories.profile_logs_dir(&profile.path),
                false,
                vec![Box::new(main_class_keep_alive), Box::new(junction_guard)],
                rpc_server,
                async |_, _| Ok(()),
            )
            .await?;

        Ok(process)
    }
}

pub async fn sync_bedrock_custom_skin_pack(mojang_dir: &std::path::Path) -> Result<()> {
    use crate::api::minecraft_skins::{get_available_skins, SkinSource};
    use futures::TryStreamExt;

    let skins = match get_available_skins().await {
        Ok(s) => s,
        Err(_) => return Ok(()),
    };

    let mut custom_skins: Vec<_> = skins.into_iter().filter(|s| matches!(s.source, SkinSource::Custom | SkinSource::CustomExternal)).collect();
    if custom_skins.is_empty() {
        return Ok(());
    }

    if let Some(pos) = custom_skins.iter().position(|s| s.is_equipped) {
        let equipped = custom_skins.remove(pos);
        custom_skins.insert(0, equipped);
    }

    let skin_pack_dir = mojang_dir.join("skin_packs").join("launcher_custom_skin");
    let texts_dir = skin_pack_dir.join("texts");
    let _ = fs::create_dir_all(&texts_dir).await;

    let mut skin_entries = Vec::new();
    let mut lang_content = String::from("skinpack.launcher_custom_skin=Launcher Custom Skins\n");

    for (idx, skin) in custom_skins.iter().enumerate() {
        let texture_stream = match crate::api::minecraft_skins::png_util::url_to_data_stream(&skin.texture).await {
            Ok(stream) => stream,
            Err(_) => continue,
        };

        let texture_data = match texture_stream
            .try_fold(Vec::new(), |mut texture, chunk| async move {
                texture.extend_from_slice(&chunk);
                Ok(texture)
            })
            .await
        {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };

        let texture_filename = format!("skin_{}.png", idx);
        let loc_name = format!("Custom Skin {}", idx + 1);

        let is_slim = matches!(skin.variant, crate::state::MinecraftSkinVariant::Slim);
        let geometry = if is_slim {
            "geometry.humanoid.customSlim"
        } else {
            "geometry.humanoid.custom"
        };

        let _ = fs::write(skin_pack_dir.join(&texture_filename), texture_data).await;

        skin_entries.push(serde_json::json!({
            "localization_name": loc_name,
            "geometry": geometry,
            "texture": texture_filename,
            "type": "free"
        }));

        lang_content.push_str(&format!("skin.launcher_custom_skin.{}={}\n", loc_name, loc_name));
    }

    if skin_entries.is_empty() {
        return Ok(());
    }

    let manifest_json = serde_json::json!({
        "format_version": 1,
        "header": {
            "name": "Launcher Custom Skins",
            "uuid": "4c94b7a1-8d23-4e8b-b8f1-34e8921a92a1",
            "version": [1, 0, 0]
        },
        "modules": [
            {
                "type": "skin_pack",
                "uuid": "7a34e8b9-1f23-4d89-b56e-821f92a34567",
                "version": [1, 0, 0]
            }
        ]
    });

    let skins_json = serde_json::json!({
        "serialize_name": "launcher_custom_skin",
        "localization_name": "launcher_custom_skin",
        "skins": skin_entries
    });

    let _ = fs::write(skin_pack_dir.join("manifest.json"), serde_json::to_string_pretty(&manifest_json).unwrap()).await;
    let _ = fs::write(skin_pack_dir.join("skins.json"), serde_json::to_string_pretty(&skins_json).unwrap()).await;
    let _ = fs::write(texts_dir.join("en_US.lang"), lang_content).await;

    Ok(())
}
