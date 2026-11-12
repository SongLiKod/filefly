// FSEvents 监听（macOS，技术文档 §4.2：事件 → 受影响目录局部重扫）
#[cfg(target_os = "macos")]
pub fn watch_all(app: tauri::AppHandle) {
    // M4 接入 core-foundation FSEventStream；事件驱动局部重扫（§12 M4）
    loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
        let _ = &app;
    }
}

#[cfg(not(target_os = "macos"))]
pub fn watch_all(_app: tauri::AppHandle) {}
