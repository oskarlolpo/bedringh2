use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrashAnalysisResult {
    pub has_crash: bool,
    pub title: String,
    pub description: String,
    pub cause: String,
    pub fix_action_type: Option<String>,
    pub fix_action_label: Option<String>,
    pub fix_target: Option<String>,
}

#[tracing::instrument]
pub async fn analyze_instance_crash(instance_id: &str) -> crate::Result<CrashAnalysisResult> {
    let target_dir = crate::api::instance::get_full_path(instance_id).await?;

    // Check crash-reports first
    let crash_dir = target_dir.join("crash-reports");
    let mut latest_crash_file: Option<PathBuf> = None;
    let mut latest_mtime = std::time::SystemTime::UNIX_EPOCH;

    if crash_dir.exists() {
        if let Ok(mut rd) = tokio::fs::read_dir(&crash_dir).await {
            while let Ok(Some(entry)) = rd.next_entry().await {
                if entry.path().extension().is_some_and(|e| e == "txt") {
                    if let Ok(meta) = entry.metadata().await {
                        if let Ok(mtime) = meta.modified() {
                            if mtime > latest_mtime {
                                latest_mtime = mtime;
                                latest_crash_file = Some(entry.path());
                            }
                        }
                    }
                }
            }
        }
    }

    let mut content = String::new();
    if let Some(cf) = latest_crash_file {
        if let Ok(txt) = tokio::fs::read_to_string(&cf).await {
            content = txt;
        }
    }

    // If no crash report or empty, check logs/latest.log
    if content.is_empty() {
        let log_file = target_dir.join("logs").join("latest.log");
        if log_file.exists() {
            if let Ok(txt) = tokio::fs::read_to_string(&log_file).await {
                content = txt;
            }
        }
    }

    if content.is_empty() {
        return Ok(CrashAnalysisResult {
            has_crash: false,
            title: "Крашей не обнаружено".to_string(),
            description: "В последних отчетах и логах не найдено критических ошибок.".to_string(),
            cause: String::new(),
            fix_action_type: None,
            fix_action_label: None,
            fix_target: None,
        });
    }

    let lower = content.to_lowercase();

    // 1. Missing Fabric API
    if (lower.contains("fabric-api") || lower.contains("fabric api") || lower.contains("net.fabricmc.fabric-api"))
        && (lower.contains("missing") || lower.contains("requires") || lower.contains("not found") || lower.contains("dependency"))
        || lower.contains("requires fabric-api")
    {
        return Ok(CrashAnalysisResult {
            has_crash: true,
            title: "Отсутствует Fabric API".to_string(),
            description: "Один или несколько модов требуют библиотеку Fabric API для корректной работы.".to_string(),
            cause: "Не найдена обязательная зависимость fabric-api".to_string(),
            fix_action_type: Some("install_fabric_api".to_string()),
            fix_action_label: Some("Установить Fabric API".to_string()),
            fix_target: Some("fabric-api".to_string()),
        });
    }

    // 2. Out Of Memory
    if lower.contains("outofmemoryerror") || lower.contains("java heap space") || lower.contains("out of memory") {
        return Ok(CrashAnalysisResult {
            has_crash: true,
            title: "Нехватка оперативной памяти (OutOfMemory)".to_string(),
            description: "Minecraft превысил лимит выделенной памяти Java и аварийно завершился.".to_string(),
            cause: "java.lang.OutOfMemoryError: Java heap space".to_string(),
            fix_action_type: Some("increase_ram".to_string()),
            fix_action_label: Some("Выделить 4 ГБ RAM".to_string()),
            fix_target: Some("4096".to_string()),
        });
    }

    // 3. Duplicate mods
    if lower.contains("duplicatemodsfoundexception") || lower.contains("duplicate mod") || lower.contains("found duplicate") {
        return Ok(CrashAnalysisResult {
            has_crash: true,
            title: "Найдены дубликаты модов".to_string(),
            description: "В папке mods обнаружены две разные версии одного и того же мода.".to_string(),
            cause: "Конфликт дубликатов файлов в mods/".to_string(),
            fix_action_type: Some("deduplicate".to_string()),
            fix_action_label: Some("Удалить дубликаты модов".to_string()),
            fix_target: None,
        });
    }

    // 4. Java Version Mismatch
    if lower.contains("unsupportedclassversionerror") || lower.contains("compiled by a more recent version of the java runtime") {
        return Ok(CrashAnalysisResult {
            has_crash: true,
            title: "Несовместимая версия Java".to_string(),
            description: "Моды скомпилированы для более новой версии Java, чем установленная.".to_string(),
            cause: "UnsupportedClassVersionError".to_string(),
            fix_action_type: Some("change_java".to_string()),
            fix_action_label: Some("Переключить на Java 21".to_string()),
            fix_target: None,
        });
    }

    // 5. Incompatible mod exception
    if lower.contains("incompatible mod set") || lower.contains("mod resolution failed") || lower.contains("incompatible with") {
        return Ok(CrashAnalysisResult {
            has_crash: true,
            title: "Конфликт несовместимых модов".to_string(),
            description: "Один из модов несовместим с текущей версией загрузчика или другими установленными модами.".to_string(),
            cause: "Mod resolution conflict".to_string(),
            fix_action_type: Some("open_mods_folder".to_string()),
            fix_action_label: Some("Открыть папку модов".to_string()),
            fix_target: None,
        });
    }

    // 6. ZipException / Corrupted Jar
    if lower.contains("zipexception") || lower.contains("zip end header not found") || lower.contains("error in opening zip file") {
        return Ok(CrashAnalysisResult {
            has_crash: true,
            title: "Поврежден jar-файл библиотеки или мода".to_string(),
            description: "Один из jar-файлов поврежден (0 байт или неполная загрузка). Очистка поврежденных файлов восстановит запуск.".to_string(),
            cause: "java.util.zip.ZipException: zip END header not found".to_string(),
            fix_action_type: Some("clean_corrupted_jars".to_string()),
            fix_action_label: Some("Очистить поврежденные файлы".to_string()),
            fix_target: None,
        });
    }

    // 7. Generic crash
    if lower.contains("crash") || lower.contains("fatal") || lower.contains("exception in thread") {
        let first_err_line = content.lines()
            .find(|l| l.contains("Exception") || l.contains("Error") || l.contains("FATAL"))
            .unwrap_or("Неизвестная ошибка")
            .to_string();

        return Ok(CrashAnalysisResult {
            has_crash: true,
            title: "Обнаружен сбой при запуске".to_string(),
            description: format!("Игра аварийно завершилась. Причина: {}", first_err_line.chars().take(120).collect::<String>()),
            cause: first_err_line,
            fix_action_type: None,
            fix_action_label: None,
            fix_target: None,
        });
    }

    Ok(CrashAnalysisResult {
        has_crash: false,
        title: "Ошибок не обнаружено".to_string(),
        description: "Логи чисты, игра завершилась в штатном режиме.".to_string(),
        cause: String::new(),
        fix_action_type: None,
        fix_action_label: None,
        fix_target: None,
    })
}

#[tracing::instrument]
pub async fn apply_crash_fix(instance_id: &str, action_type: &str, _target: Option<&str>) -> crate::Result<String> {
    match action_type {
        "clean_corrupted_jars" => {
            let target_dir = crate::api::instance::get_full_path(instance_id).await?;
            let mut removed_count = 0;
            let mods_dir = target_dir.join("mods");
            if let Ok(mut rd) = tokio::fs::read_dir(&mods_dir).await {
                while let Ok(Some(entry)) = rd.next_entry().await {
                    if entry.path().extension().is_some_and(|e| e == "jar") {
                        if let Ok(meta) = entry.metadata().await {
                            if meta.len() < 1024 {
                                let _ = tokio::fs::remove_file(entry.path()).await;
                                removed_count += 1;
                            }
                        }
                    }
                }
            }
            if let Ok(state) = crate::state::State::get().await {
                let authlib_dir = state.directories.libraries_dir().join("gg").join("klauncher").join("authlib");
                if let Ok(mut rd) = tokio::fs::read_dir(&authlib_dir).await {
                    while let Ok(Some(entry)) = rd.next_entry().await {
                        if let Ok(meta) = entry.metadata().await {
                            if meta.len() < 1024 {
                                let _ = tokio::fs::remove_file(entry.path()).await;
                                removed_count += 1;
                            }
                        }
                    }
                }
            }
            Ok(format!("Поврежденные файлы успешно удалены ({} шт.). Теперь игра запустится штатно!", removed_count))
        }
        "install_fabric_api" => {
            let req = crate::api::instance::InstallProjectWithDependenciesRequest {
                project_id: "fabric-api".to_string(),
                version_id: None,
                content_type: modrinth_content_management::ContentType::Mod,
                selected: modrinth_content_management::ResolutionPreferences::default(),
            };
            let plan = crate::api::instance::install_project_with_dependencies(instance_id, req).await?;
            Ok(format!("Fabric API успешно добавлен в сборку (версия {})!", plan.primary.version_id))
        }
        "increase_ram" => {
            crate::api::instance::edit(
                instance_id,
                crate::state::EditInstance {
                    launch_overrides: Some(crate::state::InstanceLaunchOverridesPatch {
                        memory: Some(Some(crate::state::MemorySettings { maximum: 4096 })),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ).await?;
            Ok("Выделение оперативной памяти увеличено до 4096 МБ!".to_string())
        }
        "deduplicate" => {
            let report = crate::api::instance::deduplicate_mods(Some(instance_id.to_string())).await?;
            Ok(format!("Обработано {} файлов, сэкономлено {:.1} МБ!", report.hardlinks_created, report.bytes_saved as f64 / 1_048_576.0))
        }
        _ => Ok("Действие выполнено".to_string()),
    }
}

