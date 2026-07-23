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
        let exe_dir = exe_path.parent().unwrap();
        // BLoader is required for all launches unconditionally
        let injector_name = "BLoader.dll";
        let injector_target_path = exe_dir.join(injector_name);

        let injector_bytes = include_bytes!("../../assets/BLoader.dll");
        if !injector_target_path.exists() {
            emit_legacy_log(&profile.path, "Deploying BLoader.dll...");
            fs::write(&injector_target_path, injector_bytes).await?;
        }

        let config_json = serde_json::json!({
            "disable_mod_loading": false,
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

        // Check if Bedrock Unlocker for GDK is enabled in settings
        let settings = crate::state::Settings::get(&state.pool).await?;
        let gdk_unlocker_enabled = settings.feature_flags
            .get(&crate::state::FeatureFlag::BedrockUnlockerGdk)
            .copied()
            .unwrap_or(false);

        let gdk_files = vec![
            ("winmm.dll", include_bytes!("../../assets/unlocker/gdk/winmm.dll").as_slice()),
            ("OnlineFix64.dll", include_bytes!("../../assets/unlocker/gdk/OnlineFix64.dll").as_slice()),
            ("dlllist.txt", include_bytes!("../../assets/unlocker/gdk/dlllist.txt").as_slice()),
            ("OnlineFix.ini", include_bytes!("../../assets/unlocker/gdk/OnlineFix.ini").as_slice()),
        ];

        let has_all_gdk = gdk_files.iter().all(|(n, _)| exe_dir.join(n).exists());
        if gdk_unlocker_enabled != has_all_gdk {
            let action = if gdk_unlocker_enabled { "Enable" } else { "Disable" };
            emit_legacy_log(&profile.path, &format!("Applying GDK Unlocker file changes ({})...", action));
            
            if gdk_unlocker_enabled {
                for (file_name, file_bytes) in &gdk_files {
                    let dest = exe_dir.join(file_name);
                    if dest.exists() {
                        let old_dest = exe_dir.join(format!("{}.old", file_name));
                        // Clean up former old file if any
                        let _ = fs::remove_file(&old_dest).await;
                        // Move current to old
                        let _ = fs::rename(&dest, &old_dest).await;
                    }
                    if let Err(e) = fs::write(&dest, *file_bytes).await {
                        tracing::warn!("Failed to write GDK unlocker file {}: {}", file_name, e);
                    }
                }
                
                // Add Windows Defender exclusion non-elevated (might fail, but ignore)
                let _ = Command::new("powershell")
                    .arg("-NoProfile")
                    .arg("-WindowStyle").arg("Hidden")
                    .arg("-Command")
                    .arg(&format!("Add-MpPreference -ExclusionPath '{}' -ErrorAction SilentlyContinue", exe_dir.display()))
                    .creation_flags(0x08000000)
                    .status().await;
            } else {
                let files_to_remove = ["winmm.dll", "OnlineFix64.dll", "dlllist.txt", "OnlineFix.ini", "winmm.dll.old", "OnlineFix64.dll.old"];
                for f in &files_to_remove {
                    let dest = exe_dir.join(f);
                    if dest.exists() {
                        let _ = fs::remove_file(&dest).await;
                    }
                }
            }
            emit_legacy_log(&profile.path, "GDK Bedrock Unlocker: applied patch successfully.");
        }

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
                    tracing::warn!("UWP unlocker script failed or UAC rejected");
                }
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
