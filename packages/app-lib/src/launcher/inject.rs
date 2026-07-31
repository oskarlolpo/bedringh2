use eyre::{Result, eyre as anyhow};
use std::ffi::OsStr;
use std::mem;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use std::sync::Arc;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::Debug::{
    CONTEXT, CONTEXT_FLAGS, GetThreadContext, SetThreadContext,
    WriteProcessMemory,
};
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows::Win32::System::Memory::{
    MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_EXECUTE_READWRITE,
    VirtualAllocEx, VirtualFreeEx,
};
use windows::Win32::System::Threading::{
    CREATE_NEW_CONSOLE, // [核心] 确保引入此标志
    CREATE_SUSPENDED,
    CreateProcessW,
    CreateRemoteThread,
    INFINITE,
    PROCESS_INFORMATION,
    ResumeThread,
    STARTUPINFOW,
    WaitForSingleObject,
};
use windows::core::{PCSTR, PWSTR};

pub type InjectProgressCb = Arc<dyn Fn(String) + Send + Sync>;

pub async fn grant_all_application_packages_access(path: &Path) -> Result<()> {
    // S-1-15-2-1: All Application Packages
    // S-1-5-32-545: Users

    if !path.exists() {
        return Ok(());
    }

    let is_dir = path.is_dir();
    let (perm1, perm2) = if is_dir {
        ("*S-1-15-2-1:(OI)(CI)F", "*S-1-5-32-545:(OI)(CI)F")
    } else {
        ("*S-1-15-2-1:F", "*S-1-5-32-545:F")
    };

    let mut cmd = tokio::process::Command::new("icacls");
    cmd.creation_flags(0x08000000) // CREATE_NO_WINDOW
        .arg(path)
        .arg("/grant")
        .arg(perm1)
        .arg("/grant")
        .arg(perm2);

    // Note: Do not pass /T (recursive) for directories, as (OI)(CI) sets container inheritance
    // instantly (<10ms) without traversing tens of thousands of asset files.

    let output = cmd
        .arg("/Q")
        .output()
        .await
        .map_err(|e| eyre::eyre!("Failed to execute icacls: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        eprintln!("Warning: icacls warning for {:?}: {}", path, err);
    }
    Ok(())
}

pub async fn launch_win32_with_injection(
    exe_path: &str,
    args: Option<&str>,
    dll_paths: Vec<String>,
    enable_console: bool,
    on_progress: Option<InjectProgressCb>,
) -> Result<u32> {
    let exe_path_owned = exe_path.to_string();
    let args_owned = args.map(|s| s.to_string());
    let cb = on_progress.clone();

    tokio::task::spawn_blocking(move || -> Result<u32> {
        unsafe {
            let log = |msg: &str| {
                if let Some(c) = &cb {
                    c(msg.to_string());
                }
            };

            let mut si = STARTUPINFOW::default();
            si.cb = mem::size_of::<STARTUPINFOW>() as u32;
            let mut pi = PROCESS_INFORMATION::default();

            // [核心修正]
            // 1. 基础标志：挂起进程 (为了注入)
            let mut creation_flags = CREATE_SUSPENDED;

            // 2. 控制台标志：如果启用，则强制请求新窗口
            // 只要加上这个标志，Windows 就会负责弹出默认的终端应用 (Terminal 或 CMD)
            if enable_console {
                creation_flags |= CREATE_NEW_CONSOLE;
                log("启动标志: CREATE_NEW_CONSOLE (请求独立终端窗口)");
            }

            let mut cmd_line_str = format!("\"{}\"", exe_path_owned);
            if let Some(a) = &args_owned {
                cmd_line_str.push_str(" ");
                cmd_line_str.push_str(a);
            }
            let wide_cmd: Vec<u16> = OsStr::new(&cmd_line_str)
                .encode_wide()
                .chain(Some(0))
                .collect();

            CreateProcessW(
                None,
                Option::from(PWSTR(wide_cmd.as_ptr() as *mut _)),
                None,
                None,
                false, // [关键] 设为 false，彻底切断与启动器终端的继承关系，保证窗口独立
                creation_flags,
                None,
                None,
                &si,
                &mut pi,
            )
            .map_err(|e| anyhow!("CreateProcessW failed: {:?}", e))?;

            let h_proc = pi.hProcess;
            let h_thread = pi.hThread;
            let pid = pi.dwProcessId;
            log(&format!("进程已挂起启动 PID: {}", pid));

            if !dll_paths.is_empty() {
                let h_kernel =
                    GetModuleHandleW(windows::core::w!("kernel32.dll"))?;
                let load_lib_addr =
                    GetProcAddress(h_kernel, PCSTR(b"LoadLibraryW\0".as_ptr()))
                        .ok_or_else(|| anyhow!("LoadLibraryW not found"))?
                        as u64;

                // [说明] 移除了 AllocConsole 的注入逻辑
                // 因为我们已经使用了 CREATE_NEW_CONSOLE，系统会在进程启动时自动分配控制台

                let mut path_addrs = Vec::new();
                for path in &dll_paths {
                    let wpath: Vec<u16> =
                        OsStr::new(path).encode_wide().chain(Some(0)).collect();
                    let len = wpath.len() * 2;
                    let mem = VirtualAllocEx(
                        h_proc,
                        None,
                        len,
                        MEM_COMMIT | MEM_RESERVE,
                        PAGE_EXECUTE_READWRITE,
                    );
                    if !mem.is_null() {
                        WriteProcessMemory(
                            h_proc,
                            mem,
                            wpath.as_ptr() as _,
                            len,
                            None,
                        )?;
                        path_addrs.push(mem as u64);
                        log(&format!("注入准备: {}", path));
                    }
                }

                let mut ctx: CONTEXT = mem::zeroed();
                ctx.ContextFlags = CONTEXT_FLAGS(0x100001);
                GetThreadContext(h_thread, &mut ctx)?;

                let mut shellcode = Vec::new();
                shellcode.extend_from_slice(&[
                    0x48, 0x83, 0xEC, 0x28, 0x50, 0x53, 0x51, 0x52, 0x41, 0x50,
                    0x41, 0x51, 0x41, 0x52, 0x41, 0x53,
                ]);

                for path_addr in path_addrs {
                    shellcode.extend_from_slice(&[0x48, 0xB9]);
                    shellcode.extend_from_slice(&path_addr.to_le_bytes());
                    shellcode.extend_from_slice(&[0x48, 0xB8]);
                    shellcode.extend_from_slice(&load_lib_addr.to_le_bytes());
                    shellcode.extend_from_slice(&[0xFF, 0xD0]);
                }

                shellcode.extend_from_slice(&[
                    0x41, 0x5B, 0x41, 0x5A, 0x41, 0x59, 0x41, 0x58, 0x5A, 0x59,
                    0x5B, 0x58, 0x48, 0x83, 0xC4, 0x28,
                ]);
                shellcode.extend_from_slice(&[0x48, 0xB8]);
                shellcode.extend_from_slice(&ctx.Rip.to_le_bytes());
                shellcode.extend_from_slice(&[0xFF, 0xE0]);

                let shellcode_mem = VirtualAllocEx(
                    h_proc,
                    None,
                    shellcode.len(),
                    MEM_COMMIT | MEM_RESERVE,
                    PAGE_EXECUTE_READWRITE,
                );
                WriteProcessMemory(
                    h_proc,
                    shellcode_mem,
                    shellcode.as_ptr() as _,
                    shellcode.len(),
                    None,
                )?;

                ctx.Rip = shellcode_mem as u64;
                SetThreadContext(h_thread, &ctx)?;
            }

            ResumeThread(h_thread);
            let _ = CloseHandle(h_proc);
            let _ = CloseHandle(h_thread);
            Ok(pid)
        }
    })
    .await?
}

// inject_existing_process 代码保持原样，因为它是针对已存在进程的
pub async fn inject_existing_process(
    pid: u32,
    dll_path: String,
    on_progress: Option<InjectProgressCb>,
    skip_acl: bool,
    enable_console: bool,
) -> Result<()> {
    let cb = on_progress.clone();

    tokio::task::spawn_blocking(move || -> Result<()> {
        unsafe {
            let log = |msg: &str| {
                if let Some(c) = &cb {
                    c(msg.to_string());
                }
            };

            if !skip_acl {
                let path_obj = Path::new(&dll_path);
                let _ = grant_all_application_packages_access(path_obj);
            }

            let h_proc = windows::Win32::System::Threading::OpenProcess(
                windows::Win32::System::Threading::PROCESS_ALL_ACCESS,
                false,
                pid,
            )
            .map_err(|e| anyhow!("OpenProcess failed: {:?}", e))?;

            // 对现有进程，只能尝试 RemoteThread 调用 AllocConsole/FreeConsole
            if enable_console {
                let h_kernel =
                    GetModuleHandleW(windows::core::w!("kernel32.dll"))?;

                if let Some(free_console_addr) =
                    GetProcAddress(h_kernel, PCSTR(b"FreeConsole\0".as_ptr()))
                {
                    let h_free = CreateRemoteThread(
                        h_proc,
                        None,
                        0,
                        Some(mem::transmute(free_console_addr)),
                        None,
                        0,
                        None,
                    );
                    if let Ok(h) = h_free {
                        WaitForSingleObject(h, 1000);
                        let _ = CloseHandle(h);
                    }
                }

                if let Some(alloc_console_addr) =
                    GetProcAddress(h_kernel, PCSTR(b"AllocConsole\0".as_ptr()))
                {
                    let h_console_thread = CreateRemoteThread(
                        h_proc,
                        None,
                        0,
                        Some(mem::transmute(alloc_console_addr)),
                        None,
                        0,
                        None,
                    );

                    if let Ok(h) = h_console_thread {
                        WaitForSingleObject(h, INFINITE);
                        let _ = CloseHandle(h);
                    }
                }
            }

            let wide_path: Vec<u16> =
                OsStr::new(&dll_path).encode_wide().chain(Some(0)).collect();
            let len = wide_path.len() * 2;
            let remote_mem = VirtualAllocEx(
                h_proc,
                None,
                len,
                MEM_COMMIT | MEM_RESERVE,
                PAGE_EXECUTE_READWRITE,
            );

            if remote_mem.is_null() {
                let _ = CloseHandle(h_proc);
                return Err(anyhow!("VirtualAllocEx failed"));
            }
            WriteProcessMemory(
                h_proc,
                remote_mem,
                wide_path.as_ptr() as _,
                len,
                None,
            )?;

            let h_kernel = GetModuleHandleW(windows::core::w!("kernel32.dll"))?;
            let load_lib =
                GetProcAddress(h_kernel, PCSTR(b"LoadLibraryW\0".as_ptr()))
                    .ok_or_else(|| anyhow!("LoadLibraryW not found"))?;

            let h_thread = CreateRemoteThread(
                h_proc,
                None,
                0,
                Some(mem::transmute(load_lib)),
                Some(remote_mem),
                0,
                None,
            )
            .map_err(|e| anyhow!("CreateRemoteThread failed: {:?}", e))?;

            WaitForSingleObject(h_thread, INFINITE);

            let _ = VirtualFreeEx(h_proc, remote_mem, 0, MEM_RELEASE);
            let _ = CloseHandle(h_thread);
            let _ = CloseHandle(h_proc);

            log(&format!("注入完成: {}", dll_path));
            Ok(())
        }
    })
    .await?
}

pub async fn hook_shellexecute_in_process(pid: u32) -> Result<()> {
    tokio::task::spawn_blocking(move || -> Result<()> {
        unsafe {
            use windows::Win32::System::Threading::{OpenProcess, PROCESS_ALL_ACCESS};
            use windows::Win32::System::Memory::{VirtualAllocEx, VirtualProtectEx, MEM_COMMIT, MEM_RESERVE, PAGE_EXECUTE_READWRITE, PAGE_PROTECTION_FLAGS};
            use windows::Win32::System::Diagnostics::Debug::WriteProcessMemory;

            let h_proc = OpenProcess(PROCESS_ALL_ACCESS, false, pid)
                .map_err(|e| anyhow!("OpenProcess failed: {:?}", e))?;

            if h_proc.is_invalid() {
                return Err(anyhow!("Invalid process handle"));
            }

            let h_shell32 = windows::Win32::System::LibraryLoader::LoadLibraryW(windows::core::w!("shell32.dll"))?;
            let shellexecute_w_addr = GetProcAddress(h_shell32, PCSTR(b"ShellExecuteW\0".as_ptr()))
                .ok_or_else(|| anyhow!("ShellExecuteW not found"))? as u64;

            let mut shellcode: Vec<u8> = vec![
                0x49, 0x85, 0xC0,                         // test r8, r8
                0x74, 0x32,                               // jz +0x32
                0x50, 0x51, 0x52, 0x56, 0x57,             // push rax, rcx, rdx, rsi, rdi
                0x49, 0x89, 0xC6,                         // mov rsi, r8
                0x66, 0x8B, 0x06,                         // mov ax, [rsi]
                0x66, 0x85, 0xC0,                         // test ax, ax
                0x74, 0x22,                               // jz +0x22
                0x66, 0x3D, 0x6F, 0x00,                   // cmp ax, 'o'
                0x74, 0x06,                               // je match_o
                0x66, 0x3D, 0x4F, 0x00,                   // cmp ax, 'O'
                0x75, 0x16,                               // jne next_char
                0x81, 0x7E, 0x02, 0x6E, 0x00, 0x6C, 0x00, // cmp [rsi+2], "nl"
                0x75, 0x0C,
                0x81, 0x7E, 0x06, 0x69, 0x00, 0x6E, 0x00, // cmp [rsi+6], "in"
                0x75, 0x04,
                0x5F, 0x5E, 0x5A, 0x59, 0x58,             // pop rdi, rsi, rdx, rcx, rax
                0x48, 0xC7, 0xC0, 0x21, 0x00, 0x00, 0x00, // mov rax, 33
                0xC3,                                     // ret
                0x48, 0x83, 0xC6, 0x02,                   // add rsi, 2
                0xEB, 0xD4,                               // jmp loop_start
                0x5F, 0x5E, 0x5A, 0x59, 0x58,             // pop rdi, rsi, rdx, rcx, rax
            ];

            let stub_mem = VirtualAllocEx(
                h_proc,
                None,
                shellcode.len() + 32,
                MEM_COMMIT | MEM_RESERVE,
                PAGE_EXECUTE_READWRITE,
            );

            if stub_mem.is_null() {
                let _ = CloseHandle(h_proc);
                return Err(anyhow!("VirtualAllocEx for hook stub failed"));
            }

            let mut orig_bytes = [0u8; 12];
            let _ = windows::Win32::System::Diagnostics::Debug::ReadProcessMemory(
                h_proc,
                shellexecute_w_addr as _,
                orig_bytes.as_mut_ptr() as _,
                12,
                None,
            );

            shellcode.extend_from_slice(&orig_bytes);
            let ret_addr = shellexecute_w_addr + 12;
            shellcode.extend_from_slice(&[0x48, 0xB8]);
            shellcode.extend_from_slice(&ret_addr.to_le_bytes());
            shellcode.extend_from_slice(&[0xFF, 0xE0]);

            WriteProcessMemory(
                h_proc,
                stub_mem,
                shellcode.as_ptr() as _,
                shellcode.len(),
                None,
            )?;

            let mut jmp_patch = [0u8; 12];
            jmp_patch[0] = 0x48;
            jmp_patch[1] = 0xB8;
            jmp_patch[2..10].copy_from_slice(&(stub_mem as u64).to_le_bytes());
            jmp_patch[10] = 0xFF;
            jmp_patch[11] = 0xE0;

            let mut old_protect = PAGE_PROTECTION_FLAGS(0);
            VirtualProtectEx(
                h_proc,
                shellexecute_w_addr as _,
                12,
                PAGE_EXECUTE_READWRITE,
                &mut old_protect,
            )?;

            WriteProcessMemory(
                h_proc,
                shellexecute_w_addr as _,
                jmp_patch.as_ptr() as _,
                12,
                None,
            )?;

            VirtualProtectEx(
                h_proc,
                shellexecute_w_addr as _,
                12,
                old_protect,
                &mut old_protect,
            )?;

            let _ = CloseHandle(h_proc);
            Ok(())
        }
    })
    .await?
}
