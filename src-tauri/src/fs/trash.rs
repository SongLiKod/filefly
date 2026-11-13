// 回收站真实实现（Windows $Recycle.Bin 格式）：
//   $I 文件 = 元数据（原始路径/大小/删除时间），$R 文件 = 实际内容
// 支持：列出 / 恢复到原位置（冲突自动改名）/ 彻底删除
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub id: String,        // $R 内容文件完整路径（唯一标识）
    pub i_path: String,    // $I 元数据文件路径
    pub orig_path: String, // 原始完整路径
    pub orig_name: String,
    pub size: u64,
    pub deleted_at: i64, // Unix ms
}

/// 解析 $I 元数据（V1: 24B 头 + 520B 定长名；V2: 24B 头 + 4B 名长 + 变长 UTF-16 名）
fn parse_i_file(data: &[u8]) -> Option<(u64, i64, String)> {
    if data.len() < 24 { return None; }
    let ver = u64::from_le_bytes(data[0..8].try_into().ok()?);
    let size = u64::from_le_bytes(data[8..16].try_into().ok()?);
    let ft = i64::from_le_bytes(data[16..24].try_into().ok()?);
    // FILETIME(1601-01-01 起的 100ns) → Unix epoch ms
    let deleted_ms = (ft - 11_644_473_600_000_000) / 10_000;
    let u16_at = |off: usize, n: usize| -> Vec<u16> {
        data.get(off..off + n * 2)
            .map(|sl| sl.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect())
            .unwrap_or_default()
    };
    let name = if ver >= 2 && data.len() >= 28 {
        let n = u32::from_le_bytes(data[24..28].try_into().ok()?) as usize;
        String::from_utf16_lossy(&u16_at(28, n))
    } else {
        String::from_utf16_lossy(&u16_at(24, 260))
    };
    let name = name.trim_end_matches('\0').to_string();
    if name.is_empty() { None } else { Some((size, deleted_ms, name)) }
}

/// 单盘回收站枚举（$I 元数据解析）
fn list_drive(drive: &str) -> Vec<TrashItem> {
    let mut out = Vec::new();
    let rb = PathBuf::from(format!("{}$Recycle.Bin", drive));
    let Ok(sids) = std::fs::read_dir(&rb) else { return out };
    for sid in sids.filter_map(|s| s.ok()) {
        let Ok(entries) = std::fs::read_dir(sid.path()) else { continue };
        for e in entries.filter_map(|e| e.ok()) {
            let fname = e.file_name().to_string_lossy().to_string();
            if !fname.starts_with("$I") { continue; }
            let Ok(data) = std::fs::read(e.path()) else { continue };
            let Some((size, deleted_at, orig)) = parse_i_file(&data) else { continue };
            let r_path = sid.path().join(format!("$R{}", &fname[2..]));
            let orig_name = orig.rsplit(['\\', '/']).next().unwrap_or(&orig).to_string();
            out.push(TrashItem {
                id: r_path.to_string_lossy().to_string(),
                i_path: e.path().to_string_lossy().to_string(),
                orig_path: orig,
                orig_name,
                size,
                deleted_at,
            });
        }
    }
    out
}

/// 列出所有盘回收站里的项目（无权限的 SID 目录自动跳过）。
/// 性能纪律：只枚举真实盘符 + 各盘并行（总耗时=最慢单盘而非累加）+ 15s 总预算，
/// 超预算返回已收集的部分（此前串行探测 A..Z，断连网络盘逐个阻塞 5~10s 导致超时）。
pub fn list() -> Vec<TrashItem> {
    use std::sync::mpsc::RecvTimeoutError;
    use std::time::{Duration, Instant};

    let drives = crate::fs::drive_letters();
    let (tx, rx) = std::sync::mpsc::channel::<Vec<TrashItem>>();
    for d in &drives {
        let tx = tx.clone();
        let dd = d.clone();
        // JoinHandle drop 即分离：即使本函数超预算提前返回，慢盘线程自行结束（send 进已丢弃的通道无害）
        std::thread::spawn(move || {
            let _ = tx.send(list_drive(&dd));
        });
    }
    drop(tx);
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut out = Vec::new();
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() { break; }
        match rx.recv_timeout(left) {
            Ok(items) => out.extend(items),
            Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => break,
        }
    }
    out.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    out
}

/// 恢复：$R 内容移回原始路径（重名自动追加 (1)），成功后移除 $I 元数据
pub fn restore(i_path: &str) -> Result<String, String> {
    let data = std::fs::read(i_path).map_err(|e| e.to_string())?;
    let (_, _, orig) = parse_i_file(&data).ok_or("回收站元数据损坏")?;
    let r_path = {
        let p = Path::new(i_path);
        let fname = p.file_name().map(|f| f.to_string_lossy().to_string()).ok_or("非法路径")?;
        p.with_file_name(format!("$R{}", &fname[2..]))
    };
    if !r_path.exists() { return Err("回收站内容文件已不存在".into()); }
    let mut dest = PathBuf::from(&orig);
    if dest.exists() {
        // 重名冲突：追加 (1)(2)
        let stem = dest.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let ext = dest.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
        let parent = dest.parent().unwrap_or(Path::new(".")).to_path_buf();
        let mut i = 1;
        loop {
            let cand = parent.join(format!("{} ({}){}", stem, i, ext));
            if !cand.exists() { dest = cand; break; }
            i += 1;
        }
    }
    if let Some(dir) = dest.parent() {
        let _ = std::fs::create_dir_all(dir); // 原目录可能已删除
    }
    std::fs::rename(&r_path, &dest).map_err(|e| format!("恢复失败：{}", e))?;
    let _ = std::fs::remove_file(i_path);
    Ok(dest.to_string_lossy().to_string())
}

/// 彻底删除（用户显式确认后调用）
pub fn remove_permanently(id: &str, i_path: &str) -> Result<(), String> {
    std::fs::remove_file(id).map_err(|e| e.to_string()).ok();
    std::fs::remove_file(i_path).map_err(|e| e.to_string())
}

/// 回收站总占用（字节，各盘 $I 元数据 size 求和）
pub fn total_size() -> Result<u64, String> {
    Ok(list().iter().map(|it| it.size).sum())
}

/// 清空回收站（所有盘）
pub fn empty_all() -> Result<usize, String> {
    let items = list();
    let mut n = 0;
    for it in &items {
        if remove_permanently(&it.id, &it.i_path).is_ok() { n += 1; }
    }
    Ok(n)
}
