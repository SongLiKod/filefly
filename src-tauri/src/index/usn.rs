// USN Journal 增量监听（Windows，技术文档 §4.2：REASON 过滤 rename/new/delete，≤1s 合并入库）
// 说明：完整 FSCTL_READ_USN_JOURNAL 管线较重；本实现提供 DeviceIoControl 骨架与
// 事件过滤逻辑，M2 milestone 内接入真实句柄轮转（§12 M2）。
#[cfg(target_os = "windows")]
mod imp {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS,
    };
    use windows::core::PCWSTR;

    pub const DEFAULT_REASON_FILTER: u32 = 0x0000_0001   // FILE_CREATE
        | 0x0000_0002                                    // FILE_DELETE
        | 0x0000_0004 | 0x0000_0008;                     // RENAME_NEW/OLD

    pub fn open_volume_root(root: &str) -> anyhow::Result<HANDLE> {
        let vol = format!("\\\\.\\{}", &root[..2.min(root.len())]);
        let w: Vec<u16> = vol.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            CreateFileW(
                PCWSTR(w.as_ptr()),
                0x8000_0000 | 0x4000_0000, // GENERIC_READ | GENERIC_WRITE（读 USN 需要写位）
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                HANDLE::default(),
            )
        }
        .map_err(|e| anyhow::anyhow!("open volume failed: {}", e))
    }

    /// 事件是否入索引（REASON 过滤）
    pub fn reason_should_index(reason: u32) -> bool {
        reason & DEFAULT_REASON_FILTER != 0
    }
}

#[cfg(target_os = "windows")]
pub fn watch_all(app: tauri::AppHandle) -> anyhow::Result<()> {
    // 常驻线程：逐卷开 USN Journal，读取记录 → reason 过滤 → 延迟 ≤1s 批量合并入库（§4.2）
    loop {
        std::thread::sleep(std::time::Duration::from_millis(800));
        let _ = &app; // 事件消费在 M2 接入完整 USN_RECORD 解码
    }
}

#[cfg(not(target_os = "windows"))]
pub fn watch_all(_app: tauri::AppHandle) -> anyhow::Result<()> { Ok(()) }
