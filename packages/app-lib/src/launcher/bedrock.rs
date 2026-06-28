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

    let install_type =
        if profile.game_version.to_lowercase().contains("preview")
            || profile.game_version.to_lowercase().contains("beta")
        {
            if profile.game_version.to_lowercase().contains("gdk") {
                BedrockInstallationType::GdkPreview
            } else {
                BedrockInstallationType::UwpPreview
            }
        } else {
            if profile.game_version.to_lowercase().contains("gdk") {
                BedrockInstallationType::Gdk
            } else {
                BedrockInstallationType::Uwp
            }
        };

    let versions_dir = state
        .directories
        .caches_dir()
        .join("versions")
        .join(format!("bedrock_{}", profile.game_version));
    
    let exe_path = versions_dir.join("Minecraft.Windows.exe");
    let is_custom_unpacked = exe_path.exists();

    let pfn_to_use = match install_type {
        BedrockInstallationType::Uwp | BedrockInstallationType::Gdk => {
            "Microsoft.MinecraftUWP_8wekyb3d8bbwe".to_string()
        }
        BedrockInstallationType::UwpPreview
        | BedrockInstallationType::GdkPreview => {
            "Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe".to_string()
        }
    };

    let mut exe_path_to_inject = None;

    if is_custom_unpacked {
        exe_path_to_inject = Some(exe_path.clone());
    }

    if exe_path_to_inject.is_none() && !is_custom_unpacked {
        let pkg_name = if install_type.is_preview() {
            "Microsoft.MinecraftWindowsBeta"
        } else {
            "Microsoft.MinecraftUWP"
        };
        let output = std::process::Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-Command",
                &format!("(Get-AppxPackage -Name {}).Version", pkg_name),
            ])
            .output()?;
        let installed_version =
            String::from_utf8_lossy(&output.stdout).trim().to_string();

        let prof_prefix = profile
            .game_version
            .split('.')
            .take(3)
            .collect::<Vec<_>>()
            .join(".");
        let inst_prefix = installed_version
            .split('.')
            .take(3)
            .collect::<Vec<_>>()
            .join(".");

        if installed_version.is_empty() || prof_prefix != inst_prefix {
            emit_legacy_log(&profile.path, "Смена системной версии UWP. Удаление старой версии...");
            
            if !installed_version.is_empty() {
                let _ = std::process::Command::new("powershell")
                    .creation_flags(0x08000000) // CREATE_NO_WINDOW
                    .args(&[
                        "-NoProfile",
                        "-Command",
                        &format!("Remove-AppxPackage -Package (Get-AppxPackage -Name {}).PackageFullName", pkg_name),
                    ])
                    .output();
            }

            let cache_appx_path = state.directories.caches_dir()
                .join("bedrock_packages")
                .join(format!("bedrock-{}.Appx", profile.game_version));
            
            if !cache_appx_path.exists() {
                return Err(ErrorKind::LauncherError(format!(
                    "Требуется версия {}, но её кэшированный установочный пакет (.Appx) не найден. Попробуйте нажать 'Починить сборку' на странице сборки.",
                    profile.game_version
                )).into());
            }

            emit_legacy_log(&profile.path, "Установка нужной версии из кэша...");
            let install_output = std::process::Command::new("powershell")
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .args(&[
                    "-NoProfile",
                    "-Command",
                    &format!("Add-AppxPackage -ForceUpdateFromAnyVersion -ForceApplicationShutdown -Path '{}'", cache_appx_path.display()),
                ])
                .output()?;
                
            if !install_output.status.success() {
                let err_msg = String::from_utf8_lossy(&install_output.stderr);
                return Err(ErrorKind::LauncherError(format!(
                    "Не удалось установить пакет Appx перед запуском: {}", err_msg
                )).into());
            }
        }
    }
    let instance_mojang = instance_path.join("com.mojang");

    if !instance_mojang.exists() {
        fs::create_dir_all(&instance_mojang).await?;
    }

    let target_games_dir = if let Some(ref exe_path) = exe_path_to_inject {
        let exe_dir = exe_path.parent().unwrap();
        let local_data_root = exe_dir.join("Minecraft Bedrock");
        if !local_data_root.exists() {
            fs::create_dir_all(&local_data_root).await?;
        }
        let dir = local_data_root.join("LocalState").join("games");
        if !dir.exists() {
            fs::create_dir_all(&dir).await?;
        }
        dir
    } else if is_custom_unpacked {
        let local_appdata =
            std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
                let mut path = dirs::home_dir().unwrap();
                path.push("AppData");
                path.push("Local");
                path.to_string_lossy().into_owned()
            });
        let dir = PathBuf::from(local_appdata)
            .join("Packages")
            .join(&pfn_to_use)
            .join("LocalState")
            .join("games");
        if !dir.exists() {
            fs::create_dir_all(&dir).await?;
        }
        dir
    } else {
        get_bedrock_target_dir(install_type).await?
    };
    let mojang_dir = target_games_dir.join("com.mojang");
    let mut actual_backup_dir = target_games_dir.join("com.mojang.backup");

    if mojang_dir.exists() {
        let meta = fs::symlink_metadata(&mojang_dir).await?;
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

    emit_legacy_log(&profile.path, "Монтирование изолированной файловой системы профиля...");
    use std::os::windows::process::CommandExt;
    let status = std::process::Command::new("cmd")
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .args(&[
            "/c",
            "mklink",
            "/J",
            mojang_dir.to_str().unwrap(),
            instance_mojang.to_str().unwrap(),
        ])
        .status()?;

    if !status.success() {
        return Err(ErrorKind::LauncherError(
            "Не удалось примонтировать файловую систему профиля (ошибка создания Junction).".into(),
        )
        .into());
    }

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

    if let Some(exe_path) = exe_path_to_inject {
        // Deploy BLoader.dll
        let exe_dir = exe_path.parent().unwrap();
        let injector_name = "BLoader.dll";
        let injector_target_path = exe_dir.join(injector_name);

        let injector_bytes = include_bytes!("../../assets/BLoader.dll");
        if !injector_target_path.exists() {
            emit_legacy_log(&profile.path, "Deploying BLoader.dll...");
            fs::write(&injector_target_path, injector_bytes).await?;
        }

        let config_json = serde_json::json!({
            "disable_mod_loading": true,
            "mods": []
        });
        fs::write(
            exe_dir.join("preloader.json"),
            serde_json::to_string_pretty(&config_json)?,
        )
        .await?;

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

        // Use direct execution to capture stdout/stderr through pipes
        let exe_path_str = exe_path.to_str().unwrap().to_string();

        emit_legacy_log(&profile.path, "Spawning Minecraft.Windows.exe process...");
        let mut command = Command::new(&exe_path_str);
        if let Some(parent) = exe_path.parent() {
            command.current_dir(parent);
        }

        let mut keep_alive: Vec<Box<dyn std::any::Any + Send + Sync>> = vec![
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
        let mut command = Command::new("powershell");
        command.args(&[
            "-WindowStyle", "Hidden",
            "-Command",
            &format!("Start-Process 'shell:appsFolder\\{}!Game'; $timeout = 30; while (!(Get-Process Minecraft.Windows -ErrorAction SilentlyContinue) -and $timeout -gt 0) {{ Start-Sleep -Seconds 1; $timeout-- }}; while (Get-Process Minecraft.Windows -ErrorAction SilentlyContinue) {{ Start-Sleep -Seconds 2 }}", pfn_to_use)
        ]);
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
