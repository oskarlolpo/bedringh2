use crate::api::profile::get_full_path;
use crate::error::{ErrorKind, Result};
use crate::state::{ProcessMetadata, Profile};
use crate::State;
use std::os::windows::fs::MetadataExt;
use std::path::PathBuf;
use tokio::fs;
use tokio::process::Command;

const BEDROCK_UWP_FAMILY: &str = "Microsoft.MinecraftUWP_8wekyb3d8bbwe";
const BEDROCK_PREVIEW_FAMILY: &str = "Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe";

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

async fn get_bedrock_target_dir(install_type: BedrockInstallationType) -> Result<PathBuf> {
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
        let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
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

pub async fn launch_bedrock(profile: &Profile) -> Result<ProcessMetadata> {
    let state = State::get().await?;
    let instance_path = get_full_path(&profile.path).await?;
    
    let install_type = if profile.game_version.to_lowercase().contains("preview") || profile.game_version.to_lowercase().contains("beta") {
        if profile.game_version.to_lowercase().contains("gdk") { BedrockInstallationType::GdkPreview } else { BedrockInstallationType::UwpPreview }
    } else {
        if profile.game_version.to_lowercase().contains("gdk") { BedrockInstallationType::Gdk } else { BedrockInstallationType::Uwp }
    };

    let pkg_name = if install_type.is_preview() { "Microsoft.MinecraftWindowsBeta" } else { "Microsoft.MinecraftUWP" };
    let output = std::process::Command::new("powershell")
        .args(&[
            "-NoProfile",
            "-Command",
            &format!("(Get-AppxPackage -Name {}).Version", pkg_name)
        ])
        .output()?;
    let installed_version = String::from_utf8_lossy(&output.stdout).trim().to_string();

    let prof_prefix = profile.game_version.split('.').take(3).collect::<Vec<_>>().join(".");
    let inst_prefix = installed_version.split('.').take(3).collect::<Vec<_>>().join(".");
    
    if installed_version.is_empty() || prof_prefix != inst_prefix {
        return Err(ErrorKind::LauncherError(format!(
            "Установленная версия Bedrock в системе ({}) не совпадает с версией профиля ({}). Автоматическая распаковка скачанных пакетов пока не поддерживается, поэтому лаунчер использует системный клиент.",
            if installed_version.is_empty() { "Не найдена" } else { &installed_version },
            profile.game_version
        )).into());
    }
    let instance_mojang = instance_path.join("com.mojang");

    if !instance_mojang.exists() {
        fs::create_dir_all(&instance_mojang).await?;
    }

    let target_games_dir = get_bedrock_target_dir(install_type).await?;
    let mojang_dir = target_games_dir.join("com.mojang");

    if mojang_dir.exists() {
        let meta = fs::symlink_metadata(&mojang_dir).await?;
        let is_reparse_point = (meta.file_attributes() & 0x00000400) != 0;

        if is_reparse_point {
            fs::remove_dir(&mojang_dir).await?;
        } else {
            let backup_dir = target_games_dir.join("com.mojang.backup");
            if backup_dir.exists() {
                let ts = chrono::Utc::now().timestamp();
                let unique_backup = target_games_dir.join(format!("com.mojang.backup_{}", ts));
                fs::rename(&mojang_dir, &unique_backup).await?;
            } else {
                fs::rename(&mojang_dir, &backup_dir).await?;
            }
        }
    }

    let status = std::process::Command::new("cmd")
        .args(&[
            "/c",
            "mklink",
            "/J",
            mojang_dir.to_str().unwrap(),
            instance_mojang.to_str().unwrap(),
        ])
        .status()?;

    if !status.success() {
        return Err(ErrorKind::LauncherError("Failed to create com.mojang junction".into()).into());
    }

    crate::api::profile::edit(&profile.path, |prof| {
        prof.last_played = Some(chrono::Utc::now());
        async { Ok(()) }
    })
    .await?;

    let mut command = Command::new("powershell");
    command.args(&[
        "-WindowStyle", "Hidden",
        "-Command",
        &format!("Start-Process 'shell:appsFolder\\{}!App'; Start-Sleep -Seconds 5; while (Get-Process Minecraft.Windows -ErrorAction SilentlyContinue) {{ Start-Sleep -Seconds 2 }}", install_type.package_family())
    ]);

    let main_class_keep_alive = tempfile::tempdir()?;
    let rpc_server = crate::util::rpc::RpcServerBuilder::new().launch().await?;
    
    let process = state.process_manager.insert_new_process(
        &profile.path,
        command,
        None,
        state.directories.profile_logs_dir(&profile.path),
        false,
        main_class_keep_alive,
        rpc_server,
        async |_, _| Ok(())
    ).await?;

    Ok(process)
}
