// 系统集成：回收站、打开方式、系统右键菜单入口（技术文档 §2 fs/shell.rs）
use std::path::Path;

/// 用系统默认程序打开文件（shell execute）
pub fn open_with_system(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", path])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(path).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// 在资源管理器中显示（右键「直达所在文件夹」F-12）
pub fn reveal_in_explorer(path: &str) -> Result<(), String> {
    if Path::new(path).is_dir() {
        open_with_system(path)?;
    } else {
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer")
                .arg(format!("/select,{}", path))
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open").args(["-R", path]).spawn().map_err(|e| e.to_string())?;
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        { open_with_system(path)?; }
    }
    Ok(())
}

/// 移入回收站（封装 trash crate；个人文件安全策略：不做永久删除）
pub fn to_trash(path: &str) -> Result<(), String> {
    trash::delete(path).map_err(|e| e.to_string())
}
