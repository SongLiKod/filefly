pub mod enumerate;
pub mod ops;
pub mod shell;
pub mod space;
pub mod trash;

pub use enumerate::{EntryMeta, SortField, SortOrder};

/// 真实存在的盘符（GetLogicalDrivesW 只读系统状态，不触碰网络/设备，永不阻塞）。
/// 修复：原 A..Z 逐一 Path::exists() 探测，对断连网络映射盘每次可能阻塞 5~10 秒，
/// 回收站/磁盘列表串行累加超 30 秒导致前端看门狗报"加载超时"。
pub fn drive_letters() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Storage::FileSystem::GetLogicalDrives;
        // SAFETY：无参数、无副作用，仅查询系统位掩码
        let mask = unsafe { GetLogicalDrives() };
        (0..26u32)
            .filter(|i| mask & (1 << i) != 0)
            .map(|i| format!("{}:\\", (b'A' + i as u8) as char))
            .collect()
    }
    #[cfg(not(target_os = "windows"))]
    {
        ('A'..='Z')
            .map(|c| format!("{}:\\", c))
            .filter(|d| std::path::Path::new(d).exists())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drive_letters_never_empty_on_windows() {
        let v = drive_letters();
        assert!(!v.is_empty(), "至少存在系统盘 C:\\");
        assert!(v.iter().all(|d| d.ends_with(":\\")));
        assert!(v.len() <= 26);
    }
}
