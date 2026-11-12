// NTFS Alternate Data Stream 读写（技术文档 §5.1：filename.xlsx:FileFly.Tags）
// 流名常量
pub const STREAM_NAME: &str = "FileFly.Tags";

#[derive(serde::Serialize, serde::Deserialize)]
pub struct AdsPayload {
    pub v: u32,          // 版本 1
    pub tags: Vec<String>,
    pub mtime_check: i64,
}

#[cfg(windows)]
pub fn read_tags(path: &str) -> Option<Vec<String>> {
    let ads = format!("{}:{}", path, STREAM_NAME);
    match std::fs::read_to_string(&ads) {
        Ok(s) => serde_json::from_str::<AdsPayload>(&s).ok().map(|p| p.tags),
        Err(_) => None,
    }
}

#[cfg(windows)]
pub fn write_tags(path: &str, tags: &[String]) -> Result<(), String> {
    let mtime_check = std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let payload = AdsPayload { v: 1, tags: tags.to_vec(), mtime_check };
    let ads = format!("{}:{}", path, STREAM_NAME);
    std::fs::write(&ads, serde_json::to_string(&payload).unwrap()).map_err(|e| e.to_string())
}

#[cfg(not(windows))]
pub fn read_tags(_path: &str) -> Option<Vec<String>> { None }

#[cfg(not(windows))]
pub fn write_tags(_path: &str, _tags: &[String]) -> Result<(), String> {
    Err("当前平台/文件系统不支持 NTFS ADS，已由 SQLite 双写兜底".into())
}

/// 是否 NTFS 卷（决定双写路由；exFAT/网络盘 → 仅 SQLite，技术文档 §5.1）
#[cfg(windows)]
pub fn is_ntfs(path: &str) -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetVolumeInformationW;
    let root = path.chars().take(3).collect::<String>(); // "C:\"
    let mut wroot: Vec<u16> = root.encode_utf16().collect();
    wroot.push(0);
    let mut fs_name = [0u16; 32];
    let ok = unsafe {
        GetVolumeInformationW(
            PCWSTR(wroot.as_ptr()),
            None,
            None,
            None,
            None,
            Some(&mut fs_name),
        )
    };
    ok.is_ok() && {
        let name = String::from_utf16_lossy(&fs_name);
        let name = name.trim_end_matches('\0');
        name.eq_ignore_ascii_case("NTFS")
    }
}

#[cfg(not(windows))]
pub fn is_ntfs(_path: &str) -> bool { false }
