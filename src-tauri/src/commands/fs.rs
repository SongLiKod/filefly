// fs 命令层（技术文档 §2 commands/）：全部 async，UI 线程 0 阻塞（§3 纪律 1）
use crate::fs::{enumerate, ops};
use tauri::{AppHandle, State};
use std::path::Path;

type S<'a> = State<'a, crate::AppState>;

#[tauri::command]
pub async fn fs_list(
    path: String,
    show_hidden: bool,
    sort: Option<enumerate::SortField>,
    order: Option<enumerate::SortOrder>,
    state: S<'_>,
) -> Result<Vec<enumerate::EntryMeta>, String> {
    let sort = sort.unwrap_or(enumerate::SortField::Name);
    let order = order.unwrap_or(enumerate::SortOrder::Asc);
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        enumerate::list_dir(&path, show_hidden, sort, order, &move |p| {
            crate::tags::store::read_merged(&db, p)
        })
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_stat(path: String) -> Result<enumerate::EntryMeta, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&path);
        let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
        let name = p.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or(path.clone());
        Ok(enumerate::EntryMeta {
            is_dir: meta.is_dir(),
            size: if meta.is_dir() { 0 } else { meta.len() },
            mtime: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
            ext: p.extension().map(|e| e.to_string_lossy().to_lowercase()),
            name,
            path,
            hidden: false,
            placeholder_state: "none".into(),
            tags: vec![],
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_operation(
    app: AppHandle,
    kind: ops::OpKind,
    sources: Vec<String>,
    target: Option<String>,
    conflict: Option<ops::ConflictPolicy>,
    _state: S<'_>,
) -> Result<(bool, String), String> {
    let op_id = crate::next_op_id(&app);
    let conflict = conflict.unwrap_or(ops::ConflictPolicy::Ask);
    tauri::async_runtime::spawn_blocking(move || {
        ops::run_operation(&app, op_id, kind, sources, target, conflict)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 批量重命名（P1）
#[tauri::command]
pub async fn fs_batch_rename(paths: Vec<String>, rule: ops::RenameRule) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || ops::apply_batch_rename(&paths, &rule))
        .await
        .map_err(|e| e.to_string())?
}

/// 真实用户特殊目录（桌面/文档/图片/音乐/视频/下载；SHGetKnownFolderPath，技术文档 F-07 收藏）
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SpecialDirs {
    pub home: String,
    pub desktop: String,
    pub documents: String,
    pub downloads: String,
    pub music: String,
    pub pictures: String,
    pub videos: String,
}

#[tauri::command]
pub async fn fs_special_dirs() -> Result<SpecialDirs, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let s = |d: Option<std::path::PathBuf>, sub: &str| {
            d.map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| {
                let home = std::env::var("USERPROFILE").unwrap_or_default();
                format!("{}\\{}", home.trim_end_matches('\\'), sub)
            })
        };
        Ok(SpecialDirs {
            home: s(dirs::home_dir(), ""),
            desktop: s(dirs::desktop_dir(), "Desktop"),
            documents: s(dirs::document_dir(), "Documents"),
            downloads: s(dirs::download_dir(), "Downloads"),
            music: s(dirs::audio_dir(), "Music"),
            pictures: s(dirs::picture_dir(), "Pictures"),
            videos: s(dirs::video_dir(), "Videos"),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 磁盘容量（F-06 磁盘容量条）
#[tauri::command]
pub async fn fs_drives() -> Result<Vec<DriveInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut out = Vec::new();
        for letter in 'A'..='Z' {
            let root = format!("{}:\\", letter);
            if Path::new(&root).exists() {
                let (total, free) = volume_stats(&root);
                out.push(DriveInfo {
                    name: format!("本地磁盘 ({})", letter),
                    path: root.clone(),
                    total,
                    free,
                    fs: crate::tags::ads::is_ntfs(&root).then(|| "NTFS".to_string()).unwrap_or_else(|| "exFAT/FAT".into()),
                });
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub name: String,
    pub path: String,
    pub total: u64,
    pub free: u64,
    pub fs: String,
}

#[cfg(windows)]
fn volume_stats(root: &str) -> (u64, u64) {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let w: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
    let mut total = 0u64; let mut free = 0u64;
    unsafe {
        let _ = GetDiskFreeSpaceExW(
            PCWSTR(w.as_ptr()),
            None,
            Some(&mut total),
            Some(&mut free),
        );
    }
    (total, free)
}

#[cfg(not(windows))]
fn volume_stats(root: &str) -> (u64, u64) {
    // 非平台实现返回 0，前端按未知容量渲染
    let _ = root;
    (0, 0)
}

/// 智能首页统计（F-06：分类聚合 + 最近使用）
/// 优先从索引库聚合（毫秒级）；索引未就绪时回退文件系统扫描（跳过系统目录）
#[tauri::command]
pub async fn fs_home_stats(state: S<'_>, home: String) -> Result<HomeStats, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let categories: &[(&str, &[&str])] = &[
            ("document", &["doc", "docx", "pdf", "txt", "md", "xlsx", "pptx", "xls", "ppt", "rtf"]),
            ("image", &["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "tiff"]),
            ("music", &["mp3", "flac", "ape", "wav", "ogg", "m4a", "aac"]),
            ("video", &["mp4", "mkv", "mov", "webm", "avi", "flv"]),
            ("archive", &["zip", "7z", "rar", "tar", "gz"]),
            ("installer", &["exe", "msi", "dmg", "pkg"]),
        ];
        let categorize = |ext: &str| -> Option<&str> {
            categories.iter().find_map(|(cat, exts)| {
                if exts.contains(&ext) { Some(*cat) } else { None }
            })
        };

        let conn = db.conn.lock();
        // 索引库聚合：全表 ext 分组（索引库有真实全盘数据，即时返回）
        let total_indexed: i64 = conn
            .query_row("SELECT COUNT(*) FROM files WHERE is_dir = 0", [], |r| r.get(0))
            .unwrap_or(0);
        if total_indexed >= 200 {
            let mut counts = std::collections::HashMap::new();
            if let Ok(mut stmt) = conn.prepare(
                "SELECT ext, COUNT(*) FROM files WHERE is_dir = 0 AND ext IS NOT NULL GROUP BY ext",
            ) {
                if let Ok(rows) = stmt.query_map([], |r| {
                    Ok((r.get::<_, Option<String>>(0)?.unwrap_or_default(), r.get::<_, i64>(1)?))
                }) {
                    for (ext, n) in rows.flatten() {
                        if let Some(cat) = categorize(&ext.to_lowercase()) {
                            *counts.entry(cat.to_string()).or_insert(0u64) += n as u64;
                        }
                    }
                }
            }
            let mut recent = Vec::new();
            if let Ok(mut stmt) = conn.prepare(
                "SELECT path, mtime FROM files WHERE is_dir = 0 ORDER BY mtime DESC LIMIT 12",
            ) {
                if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))) {
                    for p in rows.flatten() { recent.push(p); }
                }
            }
            return Ok(HomeStats {
                counts,
                recent_files: recent.into_iter().map(|(path, mtime)| RecentFile { path, mtime }).collect(),
            });
        }
        drop(conn);

        // 回退：文件系统扫描（跳过系统/垃圾目录，避免 AppData 海量遍历导致统计永不返回）
        let skipped = ["appdata", "application data", "windows", "program files", "program files (x86)",
            "programdata", "node_modules", ".git", ".cache", "$recycle.bin", "system volume information",
            "ntuser.dat", "appdata(migrated)"];
        let mut counts = std::collections::HashMap::new();
        let mut recent = Vec::new();
        let home_dir = Path::new(&home);
        let mut stack = vec![(home_dir.to_path_buf(), 0usize)];
        while let Some((dir, depth)) = stack.pop() {
            if depth > 6 { continue; }
            let Some(name) = dir.file_name().map(|n| n.to_string_lossy().to_lowercase()) else { continue };
            if depth > 0 && skipped.iter().any(|s| name == *s) { continue; }
            if let Ok(rd) = std::fs::read_dir(&dir) {
                for e in rd.filter_map(|e| e.ok()) {
                    let p = e.path();
                    if p.is_dir() {
                        stack.push((p, depth + 1));
                    } else {
                        let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
                        if let Some(cat) = categorize(&ext) {
                            *counts.entry(cat.to_string()).or_insert(0u64) += 1;
                        }
                        if let Ok(m) = e.metadata() {
                            if let Ok(mt) = m.modified() {
                                recent.push((p.to_string_lossy().to_string(),
                                    mt.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)));
                            }
                        }
                    }
                }
            }
        }
        recent.sort_by(|a, b| b.1.cmp(&a.1));
        Ok(HomeStats {
            counts: counts.into_iter().collect(),
            recent_files: recent.into_iter().take(12).map(|(p, t)| RecentFile { path: p, mtime: t }).collect(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 分类文件列表（首页分类卡片点击进入）：索引可用走索引（ext 不区分大小写），否则回退文件系统扫描。
/// 与 fs_home_stats 共用同一张分类表，保证"统计有数、点进去也有数"。
#[tauri::command]
pub async fn fs_category_files(state: S<'_>, category: String, home: String) -> Result<Vec<crate::index::db::SearchHit>, String> {
    let categories: &[(&str, &[&str])] = &[
        ("document", &["doc", "docx", "pdf", "txt", "md", "xlsx", "pptx", "xls", "ppt", "rtf"]),
        ("image", &["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "tiff"]),
        ("music", &["mp3", "flac", "ape", "wav", "ogg", "m4a", "aac"]),
        ("video", &["mp4", "mkv", "mov", "webm", "avi", "flv"]),
        ("archive", &["zip", "7z", "rar", "tar", "gz"]),
        ("installer", &["exe", "msi", "dmg", "pkg"]),
    ];
    let exts: Vec<String> = categories
        .iter()
        .find(|(k, _)| *k == category)
        .map(|(_, exts)| exts.iter().map(|e| e.to_string()).collect())
        .unwrap_or_default();
    if exts.is_empty() {
        return Err(format!("未知分类：{}", category));
    }
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.conn.lock();
        let total_indexed: i64 = conn
            .query_row("SELECT COUNT(*) FROM files WHERE is_dir = 0", [], |r| r.get(0))
            .unwrap_or(0);
        if total_indexed >= 200 {
            // 索引聚合：LOWER(ext) 匹配，避免 "JPG" vs "jpg" 大小写漏配
            let list = exts.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect::<Vec<_>>().join(",");
            let sql = format!(
                "SELECT name, path, size, mtime, ext FROM files \
                 WHERE is_dir = 0 AND ext IS NOT NULL AND LOWER(ext) IN ({list}) \
                 ORDER BY mtime DESC LIMIT 1000"
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let params: Vec<Box<dyn rusqlite::ToSql>> =
                exts.iter().map(|e| Box::new(e.clone()) as Box<dyn rusqlite::ToSql>).collect();
            let mut out = Vec::new();
            if let Ok(rows) = stmt.query(rusqlite::params_from_iter(params.iter().map(|b| b.as_ref()))) {
                let mut rows = rows;
                while let Ok(Some(r)) = rows.next() {
                    out.push(crate::index::db::SearchHit {
                        name: r.get(0).map_err(|e| e.to_string())?,
                        path: r.get::<_, Option<String>>(1).map_err(|e| e.to_string())?.unwrap_or_default(),
                        size: r.get(2).unwrap_or(0),
                        mtime: r.get(3).unwrap_or(0),
                        is_dir: false,
                        ext: r.get(4).ok(),
                    });
                }
            }
            return Ok(out);
        }
        drop(conn);

        // 回退：真实文件系统扫描（与 fs_home_stats 回退同规则，跳过系统/垃圾目录）
        let skipped = ["appdata", "application data", "windows", "program files", "program files (x86)",
            "programdata", "node_modules", ".git", ".cache", "$recycle.bin", "system volume information",
            "ntuser.dat", "appdata(migrated)"];
        let ext_set: std::collections::HashSet<&str> = exts.iter().map(|s| s.as_str()).collect();
        let mut out: Vec<crate::index::db::SearchHit> = Vec::new();
        let home_dir = Path::new(&home);
        let mut stack = vec![(home_dir.to_path_buf(), 0usize)];
        while let Some((dir, depth)) = stack.pop() {
            if depth > 6 { continue; }
            let Some(name) = dir.file_name().map(|n| n.to_string_lossy().to_lowercase()) else { continue };
            if depth > 0 && skipped.iter().any(|s| name == *s) { continue; }
            if let Ok(rd) = std::fs::read_dir(&dir) {
                for e in rd.filter_map(|e| e.ok()) {
                    let p = e.path();
                    if p.is_dir() {
                        stack.push((p, depth + 1));
                    } else {
                        let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
                        if !ext.is_empty() && ext_set.contains(ext.as_str()) {
                            let (size, mtime) = e.metadata().map(|m| (
                                m.len() as i64,
                                m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                    .map(|d| d.as_millis() as i64).unwrap_or(0),
                            )).unwrap_or((0, 0));
                            out.push(crate::index::db::SearchHit {
                                name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                                path: p.to_string_lossy().to_string(),
                                size, mtime, is_dir: false, ext: Some(ext),
                            });
                        }
                    }
                }
            }
        }
        out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
        out.truncate(1000);
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeStats {
    pub counts: std::collections::HashMap<String, u64>,
    pub recent_files: Vec<RecentFile>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub path: String,
    pub mtime: i64,
}

/// 最近使用记录（F-22）
#[tauri::command]
pub async fn fs_recent(state: S<'_>, limit: Option<usize>) -> Result<Vec<(String, String, i64)>, String> {
    let limit = limit.unwrap_or(50);
    let conn = state.db.conn.lock();
    let mut out = Vec::new();
    let mut stmt = conn
        .prepare("SELECT path, kind, opened_at FROM recent_items ORDER BY opened_at DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![limit as i64], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))
        .map_err(|e| e.to_string())?;
    for r in rows.flatten() {
        out.push(r);
    }
    Ok(out)
}

#[tauri::command]
pub async fn fs_record_recent(path: String, kind: Option<String>, state: S<'_>) -> Result<(), String> {
    state
        .db
        .conn
        .lock()
        .execute(
            "INSERT INTO recent_items(path, kind, opened_at) VALUES(?1, ?2, strftime('%s','now'))
             ON CONFLICT(path) DO UPDATE SET opened_at = strftime('%s','now')",
            rusqlite::params![path, kind.unwrap_or_else(|| "file".into())],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 缩略图（F-03：异步管线 + 双层缓存）
#[tauri::command]
pub async fn fs_thumbnail(path: String, mtime: i64) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::thumbs::get_or_create(&path, mtime))
        .await
        .map_err(|e| e.to_string())?
}

/// 目录监听（前端刷新信号；Windows USN / macOS FSEvents 由索引线程统一处理，此处为轻量 mtime 轮询信号）
#[tauri::command]
pub async fn fs_watch(path: String) -> Result<(), String> {
    // 前端在获得目录 mtime 变化事件时调用 fs_list 刷新（M2 接完整推送事件 fs:changed）
    let _ = path;
    Ok(())
}

/// 用系统默认程序打开文件（真实 Windows 行为：双击 .docx 起 Word、.mp4 起播放器）
#[tauri::command]
pub async fn fs_open(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || crate::fs::shell::open_with_system(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// 在指定目录打开 Windows 终端（cmd），工作目录即当前浏览目录
#[tauri::command]
pub async fn fs_open_terminal(path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.is_dir() {
        return Err(format!("不是有效的目录：{}", path));
    }
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            std::process::Command::new("cmd")
                .arg("/k")
                .arg("title")
                .arg("FileFly")
                .current_dir(&p)
                .creation_flags(0x00000010) // CREATE_NEW_CONSOLE：独立控制台窗口
                .spawn()
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        #[cfg(not(target_os = "windows"))]
        {
            std::process::Command::new("sh")
                .current_dir(&p)
                .spawn()
                .map_err(|e| e.to_string())?;
            Ok(())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 在 Windows 资源管理器中定位该文件（explorer /select）
#[tauri::command]
pub async fn fs_reveal(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || crate::fs::shell::reveal_in_explorer(&path))
        .await
        .map_err(|e| e.to_string())?
}

// —— 回收站（真实实现：$Recycle.Bin $I/$R 解析）——

#[tauri::command]
pub async fn fs_trash_list() -> Result<Vec<crate::fs::trash::TrashItem>, String> {
    tauri::async_runtime::spawn_blocking(crate::fs::trash::list)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_trash_restore(i_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::fs::trash::restore(&i_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_trash_delete(id: String, i_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || crate::fs::trash::remove_permanently(&id, &i_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_trash_empty() -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(crate::fs::trash::empty_all)
        .await
        .map_err(|e| e.to_string())?
}

/// 映射的网络驱动器（DRIVE_REMOTE），真实可浏览
#[tauri::command]
pub async fn fs_network_drives() -> Result<Vec<DriveInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut out = Vec::new();
        for letter in 'A'..='Z' {
            let root = format!("{}:\\", letter);
            if Path::new(&root).exists() && is_remote_drive(&root) {
                let (total, free) = volume_stats(&root);
                out.push(DriveInfo {
                    name: format!("网络磁盘 ({}:)", letter),
                    path: root,
                    total,
                    free,
                    fs: "网络".into(),
                });
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(windows)]
fn is_remote_drive(root: &str) -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDriveTypeW;
    let w: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
    // DRIVE_REMOTE = 4
    unsafe { GetDriveTypeW(PCWSTR(w.as_ptr())) == 4 }
}

#[cfg(not(windows))]
fn is_remote_drive(_root: &str) -> bool { false }

/// 重复文件扫描（P1）
#[tauri::command]
pub async fn fs_duplicates_scan(roots: Vec<String>, max_depth: Option<usize>) -> Result<Vec<ops::DuplicateGroup>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(ops::find_duplicates(&roots, max_depth.unwrap_or(4)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 压缩包免解压浏览（P1：zip/7z/rar 只读）
#[tauri::command]
pub async fn fs_archive_list(path: String) -> Result<Vec<ArchiveMember>, String> {
    let task = tauri::async_runtime::spawn_blocking(move || {
        let ext = Path::new(&path)
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        match ext.as_str() {
            "zip" => list_zip(&path),
            "7z" => list_7z(&path),
            "rar" => Err("RAR 由 unrar 集成提供（M3）".into()),
            _ => Err("不支持的压缩格式".into()),
        }
    });
    // 30s 超时：防止超大/损坏压缩包解析卡住导致前端永远停留在加载态
    match tokio::time::timeout(std::time::Duration::from_secs(30), task).await {
        Ok(r) => r.map_err(|e| e.to_string())?,
        Err(_) => Err("压缩包读取超时（30 秒）".into()),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveMember {
    pub name: String,
    pub size: u64,
    pub compressed: u64,
    pub is_dir: bool,
}

fn list_zip(path: &str) -> Result<Vec<ArchiveMember>, String> {
    let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for i in 0..z.len() {
        let e = z.by_index_raw(i).map_err(|e| e.to_string())?;
        out.push(ArchiveMember {
            name: e.name().to_string(),
            size: e.size(),
            compressed: e.compressed_size(),
            is_dir: e.is_dir(),
        });
    }
    Ok(out)
}

fn list_7z(path: &str) -> Result<Vec<ArchiveMember>, String> {
    use sevenz_rust::{Password, SevenZReader};
    let z = SevenZReader::open(path, Password::empty())
        .map_err(|e| e.to_string())?;
    Ok(z.archive().files
        .iter()
        .map(|e| ArchiveMember {
            name: e.name().to_string(),
            size: e.size(),
            compressed: 0,
            is_dir: e.is_directory(),
        })
        .collect())
}
