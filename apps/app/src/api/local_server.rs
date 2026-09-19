use crate::api::Result;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use sysinfo::{Pid, System};
use tauri::plugin::TauriPlugin;

struct ServerProcessState {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    logs: Arc<Mutex<Vec<String>>>,
    is_running: Arc<AtomicBool>,
    pid: Arc<Mutex<Option<u32>>>,
    path: PathBuf,
    cached_disk_size: Arc<Mutex<(f64, Instant)>>,
}

static SERVERS: LazyLock<DashMap<String, Arc<ServerProcessState>>> = LazyLock::new(DashMap::new);
static SYSTEM: LazyLock<Mutex<System>> = LazyLock::new(|| Mutex::new(System::new_all()));

pub fn init<R: tauri::Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("local-server")
        .invoke_handler(tauri::generate_handler![
            local_server_start,
            local_server_stop,
            local_server_send_command,
            local_server_get_logs,
            local_server_get_status,
            local_server_get_metrics,
        ])
        .build()
}

fn calculate_dir_size(path: &Path) -> u64 {
    let mut total_size = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    total_size += calculate_dir_size(&entry.path());
                } else {
                    total_size += meta.len();
                }
            }
        }
    }
    total_size
}

fn collect_process_tree(sys: &System, root_pid: Pid) -> Vec<Pid> {
    let mut tree = vec![root_pid];
    let mut to_check = vec![root_pid];

    while let Some(parent) = to_check.pop() {
        for (pid, proc) in sys.processes() {
            if proc.parent() == Some(parent) && !tree.contains(pid) {
                tree.push(*pid);
                to_check.push(*pid);
            }
        }
    }
    tree
}

fn find_java_executable() -> String {
    // 1. Try "java" directly in system PATH
    let mut test_cmd = Command::new("java");
    test_cmd.arg("-version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        test_cmd.creation_flags(0x0800_0000);
    }
    if test_cmd.output().is_ok() {
        return "java".to_string();
    }

    // 2. Try JAVA_HOME
    if let Ok(jh) = std::env::var("JAVA_HOME") {
        let jh_path = PathBuf::from(&jh).join("bin").join(if cfg!(windows) { "java.exe" } else { "java" });
        if jh_path.exists() {
            return jh_path.to_string_lossy().to_string();
        }
    }

    // 3. Fallback check standard paths
    if cfg!(windows) {
        let standard_paths = [
            r"C:\Program Files\Java",
            r"C:\Program Files\Eclipse Adoptium",
            r"C:\Program Files\BellSoft",
            r"C:\Program Files\Microsoft",
            r"C:\Program Files\Amazon Corretto",
            r"C:\Program Files\Zulu",
        ];

        for sp in &standard_paths {
            let p = Path::new(sp);
            if p.exists() {
                if let Ok(entries) = std::fs::read_dir(p) {
                    for entry in entries.flatten() {
                        let java_exe = entry.path().join("bin").join("java.exe");
                        if java_exe.exists() {
                            return java_exe.to_string_lossy().to_string();
                        }
                    }
                }
            }
        }
    }

    "java".to_string()
}

#[derive(Serialize)]
pub struct LocalServerLogsResponse {
    pub logs: Vec<String>,
    pub total: usize,
    pub running: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct LocalServerMetrics {
    pub cpu_percent: f32,
    pub ram_used_mb: u64,
    pub ram_total_mb: u64,
    pub disk_mb: f64,
    pub running: bool,
    pub pid: Option<u32>,
}

#[tauri::command]
pub async fn local_server_start(
    server_id: String,
    server_path: String,
    min_ram_mb: Option<u32>,
    max_ram_mb: Option<u32>,
    jvm_args: Option<String>,
    java_path: Option<String>,
) -> Result<u32> {
    let s_path = PathBuf::from(&server_path);
    let jar_path = s_path.join("server.jar");

    if !jar_path.exists() {
        return Err(theseus::Error::from(theseus::ErrorKind::OtherError(format!(
            "Файл server.jar не найден в папке {}",
            server_path
        ))).into());
    }

    // Ensure eula.txt has eula=true
    let eula_path = s_path.join("eula.txt");
    let _ = std::fs::write(&eula_path, "eula=true\n");

    // If already running, return existing PID
    if let Some(existing) = SERVERS.get(&server_id) {
        if existing.is_running.load(Ordering::SeqCst) {
            if let Ok(ch_opt) = existing.child.lock() {
                if let Some(ref ch) = *ch_opt {
                    return Ok(ch.id());
                }
            }
        }
    }

    let java_bin = if let Some(custom) = java_path.filter(|p| !p.trim().is_empty()) {
        if Path::new(&custom).exists() {
            custom
        } else {
            find_java_executable()
        }
    } else {
        find_java_executable()
    };

    let min_ram = min_ram_mb.unwrap_or(1024);
    let max_ram = max_ram_mb.unwrap_or(4096);

    let mut cmd = Command::new(&java_bin);
    cmd.arg(format!("-Xms{}M", min_ram))
        .arg(format!("-Xmx{}M", max_ram));

    // Append extra JVM flags if provided
    if let Some(ref extra_flags) = jvm_args {
        for arg in extra_flags.split_whitespace() {
            let trimmed = arg.trim();
            if !trimmed.is_empty() {
                cmd.arg(trimmed);
            }
        }
    }

    cmd.arg("-jar")
        .arg("server.jar")
        .arg("nogui")
        .current_dir(&s_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    tracing::info!("Starting Minecraft local server with command: {:?} in {:?}", cmd, s_path);

    let mut child = cmd.spawn().map_err(|e| {
        theseus::Error::from(theseus::ErrorKind::OtherError(format!("Не удалось запустить Java процесс: {}", e)))
    })?;

    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdin = child.stdin.take();

    let logs = Arc::new(Mutex::new(Vec::new()));
    let is_running = Arc::new(AtomicBool::new(true));
    let child_arc = Arc::new(Mutex::new(Some(child)));
    let stdin_arc = Arc::new(Mutex::new(stdin));
    let pid_arc = Arc::new(Mutex::new(Some(pid)));

    // Initial disk size calculation
    let initial_disk_mb = (calculate_dir_size(&s_path) as f64) / (1024.0 * 1024.0);
    let cached_disk_size = Arc::new(Mutex::new((initial_disk_mb, Instant::now())));

    // Append initial log
    {
        if let Ok(mut l) = logs.lock() {
            l.push(format!("[Система] Локальный сервер запущен через Java (PID: {})", pid));
            l.push(format!("[Система] Память: Xms {}M, Xmx {}M. Java: {}", min_ram, max_ram, java_bin));
            if let Some(ref extra) = jvm_args {
                if !extra.trim().is_empty() {
                    l.push(format!("[Система] Дополнительные флаги JVM: {}", extra.trim()));
                }
            }
            l.push(format!("[Система] Рабочая папка: {}", server_path));
        }
    }

    // Stdout reader thread
    if let Some(stdout) = stdout {
        let logs_clone = logs.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                if let Ok(mut l) = logs_clone.lock() {
                    l.push(line);
                    if l.len() > 3000 {
                        l.remove(0);
                    }
                }
            }
        });
    }

    // Stderr reader thread
    if let Some(stderr) = stderr {
        let logs_clone = logs.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                if let Ok(mut l) = logs_clone.lock() {
                    l.push(format!("[STDERR] {}", line));
                    if l.len() > 3000 {
                        l.remove(0);
                    }
                }
            }
        });
    }

    // Waiter thread
    let child_wait = child_arc.clone();
    let is_running_wait = is_running.clone();
    let logs_wait = logs.clone();
    let pid_wait = pid_arc.clone();
    std::thread::spawn(move || {
        let status = {
            let mut opt = child_wait.lock().ok();
            if let Some(ref mut child_opt) = opt {
                if let Some(ref mut ch) = **child_opt {
                    ch.wait().ok()
                } else {
                    None
                }
            } else {
                None
            }
        };

        is_running_wait.store(false, Ordering::SeqCst);
        if let Ok(mut p) = pid_wait.lock() {
            *p = None;
        }
        if let Ok(mut l) = logs_wait.lock() {
            if let Some(st) = status {
                l.push(format!("[Система] Процесс сервера завершился с кодом: {:?}", st.code()));
            } else {
                l.push("[Система] Процесс сервера остановлен.".to_string());
            }
        }
    });

    let state = Arc::new(ServerProcessState {
        child: child_arc,
        stdin: stdin_arc,
        logs,
        is_running,
        pid: pid_arc,
        path: s_path,
        cached_disk_size,
    });

    SERVERS.insert(server_id, state);

    Ok(pid)
}

#[tauri::command]
pub async fn local_server_send_command(server_id: String, command: String) -> Result<()> {
    if let Some(state) = SERVERS.get(&server_id) {
        if !state.is_running.load(Ordering::SeqCst) {
            return Err(theseus::Error::from(theseus::ErrorKind::OtherError("Сервер не запущен".to_string())).into());
        }

        // Add to logs
        if let Ok(mut l) = state.logs.lock() {
            l.push(format!("> {}", command));
        }

        // Write to stdin
        if let Ok(mut stdin_opt) = state.stdin.lock() {
            if let Some(ref mut stdin) = *stdin_opt {
                writeln!(stdin, "{}", command).map_err(|e| {
                    theseus::Error::from(theseus::ErrorKind::OtherError(format!("Ошибка записи в консоль сервера: {}", e)))
                })?;
                let _ = stdin.flush();
                return Ok(());
            }
        }
    }

    Err(theseus::Error::from(theseus::ErrorKind::OtherError("Сервер не найден или не запущен".to_string())).into())
}

#[tauri::command]
pub async fn local_server_stop(server_id: String) -> Result<()> {
    if let Some(state) = SERVERS.get(&server_id) {
        if state.is_running.load(Ordering::SeqCst) {
            if let Ok(mut l) = state.logs.lock() {
                l.push("[Система] Отправка команды 'stop' серверу Minecraft...".to_string());
            }

            // 1. Try graceful stop
            if let Ok(mut stdin_opt) = state.stdin.lock() {
                if let Some(ref mut stdin) = *stdin_opt {
                    let _ = writeln!(stdin, "stop");
                    let _ = stdin.flush();
                }
            }

            // 2. Wait up to 10 seconds, then kill if not exited
            let child_clone = state.child.clone();
            let is_running_clone = state.is_running.clone();
            let pid_clone = state.pid.clone();
            std::thread::spawn(move || {
                for _ in 0..20 {
                    std::thread::sleep(Duration::from_millis(500));
                    if !is_running_clone.load(Ordering::SeqCst) {
                        return;
                    }
                }

                // Force kill if still hanging
                if let Ok(mut opt) = child_clone.lock() {
                    if let Some(ref mut ch) = *opt {
                        #[cfg(windows)]
                        {
                            let pid = ch.id();
                            let mut kill_cmd = std::process::Command::new("taskkill");
                            kill_cmd.args(&["/PID", &pid.to_string(), "/T", "/F"]);
                            use std::os::windows::process::CommandExt;
                            kill_cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
                            let _ = kill_cmd.output();
                        }
                        let _ = ch.kill();
                    }
                }
                is_running_clone.store(false, Ordering::SeqCst);
                if let Ok(mut p) = pid_clone.lock() {
                    *p = None;
                }
            });
        }
        return Ok(());
    }

    Ok(())
}

#[tauri::command]
pub async fn local_server_get_logs(server_id: String, since_index: usize) -> Result<LocalServerLogsResponse> {
    if let Some(state) = SERVERS.get(&server_id) {
        let running = state.is_running.load(Ordering::SeqCst);
        if let Ok(l) = state.logs.lock() {
            let total = l.len();
            let slice = if since_index < total {
                l[since_index..].to_vec()
            } else {
                Vec::new()
            };
            return Ok(LocalServerLogsResponse {
                logs: slice,
                total,
                running,
            });
        }
    }

    Ok(LocalServerLogsResponse {
        logs: Vec::new(),
        total: 0,
        running: false,
    })
}

#[tauri::command]
pub async fn local_server_get_status(server_id: String) -> Result<bool> {
    if let Some(state) = SERVERS.get(&server_id) {
        return Ok(state.is_running.load(Ordering::SeqCst));
    }
    Ok(false)
}

#[tauri::command]
pub async fn local_server_get_metrics(
    server_id: String,
    server_path: Option<String>,
) -> Result<LocalServerMetrics> {
    let mut cpu_percent = 0.0f32;
    let mut ram_used_mb = 0u64;
    let mut running = false;
    let mut pid_res = None;

    let target_path = if let Some(state) = SERVERS.get(&server_id) {
        running = state.is_running.load(Ordering::SeqCst);
        if running {
            if let Ok(p_opt) = state.pid.lock() {
                pid_res = *p_opt;
            }
        }
        Some(state.path.clone())
    } else {
        server_path.map(PathBuf::from)
    };

    let ram_total_mb = {
        let mut sys = SYSTEM.lock().unwrap();
        if let Some(pid_num) = pid_res {
            let root_pid = Pid::from_u32(pid_num);
            sys.refresh_all();
            let pids = collect_process_tree(&sys, root_pid);
            let mut total_bytes = 0u64;
            let mut total_cpu = 0.0f32;
            for p in pids {
                if let Some(proc) = sys.process(p) {
                    total_bytes += proc.memory();
                    total_cpu += proc.cpu_usage();
                }
            }
            ram_used_mb = total_bytes / (1024 * 1024);
            let num_cpus = sys.cpus().len().max(1) as f32;
            cpu_percent = ((total_cpu / num_cpus) * 10.0).round() / 10.0;
        } else {
            // Just refresh memory if needed
            sys.refresh_memory();
        }
        sys.total_memory() / (1024 * 1024)
    };

    // Calculate disk size with 5-second cache
    let mut disk_mb = 0.0f64;
    if let Some(ref p) = target_path {
        if let Some(state) = SERVERS.get(&server_id) {
            if let Ok(mut cache) = state.cached_disk_size.lock() {
                if cache.1.elapsed().as_secs() >= 5 {
                    let bytes = calculate_dir_size(p);
                    let mb = (bytes as f64) / (1024.0 * 1024.0);
                    *cache = (mb, Instant::now());
                }
                disk_mb = cache.0;
            }
        } else if p.exists() {
            let bytes = calculate_dir_size(p);
            disk_mb = (bytes as f64) / (1024.0 * 1024.0);
        }
    }

    Ok(LocalServerMetrics {
        cpu_percent,
        ram_used_mb,
        ram_total_mb,
        disk_mb,
        running,
        pid: pid_res,
    })
}
