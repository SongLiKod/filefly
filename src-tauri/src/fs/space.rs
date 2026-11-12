// 磁盘空间分析引擎（用户需求：磁盘占用分析 + 清理）
// 纪律（技术文档 §3）：全异步 spawn_blocking，UI 线程 0 阻塞；迭代栈遍历防爆栈；
// 并发 8 worker；进度事件节流；cancel_token 支持随时取消；partial 标记截断。
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const SCAN_TOKEN: &str = "space-scan";
const WORKERS: usize = 8;
const PROGRESS_EVERY: u64 = 500; // 每 500 条目发一次进度事件
const ENTRY_CAP: u64 = 3_000_000; // 全局条目保险丝
const TOP_FILES: usize = 50;

/// 目录统计（一个直接子项的递归聚合）
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DirStat {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub files: u64,
    pub dirs: u64,
    pub is_dir: bool,
    /// true = 因取消/超量提前截断，数值偏小
    pub partial: bool,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub root: String,
    pub children: Vec<DirStat>,
    pub top_files: Vec<DirStat>,
    pub total_size: u64,
    pub total_files: u64,
    pub total_dirs: u64,
    pub scanned_entries: u64,
    pub cancelled: bool,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub scanned: u64,
    pub current_path: String,
}

/// 扫描会话共享状态
struct ScanShared {
    entries: AtomicUsize,
    cancelled: std::sync::atomic::AtomicBool,
    top: Mutex<BinaryHeap<Reverse<(u64, String, String)>>>, // (size, path, name) 小顶堆
}

impl ScanShared {
    fn record_file(&self, path: &Path, name: &str, size: u64) {
        let mut top = self.top.lock().unwrap();
        if top.len() < TOP_FILES {
            top.push(Reverse((size, path.to_string_lossy().to_string(), name.to_string())));
        } else if let Some(Reverse((min, _, _))) = top.peek() {
            if size > *min {
                top.pop();
                top.push(Reverse((size, path.to_string_lossy().to_string(), name.to_string())));
            }
        }
    }
}

/// 单棵子树迭代遍历统计（跳过符号链接；遇取消立即返回 partial）
fn walk_tree(
    root: &Path,
    shared: &ScanShared,
    app: Option<&tauri::AppHandle>,
    deadline: Instant,
) -> DirStat {
    let mut stat = DirStat {
        path: root.to_string_lossy().to_string(),
        name: root.file_name().map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| root.to_string_lossy().to_string()),
        size: 0, files: 0, dirs: 0, is_dir: true, partial: false,
    };
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    let mut since_progress: u64 = 0;
    'outer: while let Some(dir) = stack.pop() {
        if shared.cancelled.load(Ordering::Relaxed) || Instant::now() >= deadline
            || shared.entries.load(Ordering::Relaxed) as u64 > ENTRY_CAP {
            stat.partial = true;
            break;
        }
        let rd = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue, // 无权限/已消失：静默跳过
        };
        for entry in rd.flatten() {
            shared.entries.fetch_add(1, Ordering::Relaxed);
            since_progress += 1;
            if since_progress >= PROGRESS_EVERY {
                since_progress = 0;
                if let Some(app) = app { emit_progress(app, shared); }
            }
            if shared.cancelled.load(Ordering::Relaxed) || Instant::now() >= deadline {
                stat.partial = true;
                break 'outer;
            }
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                stat.dirs += 1;
                stack.push(entry.path());
            } else {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                stat.size += size;
                stat.files += 1;
                shared.record_file(&entry.path(), &entry.file_name().to_string_lossy(), size);
            }
        }
    }
    stat
}

fn emit_progress(app: &tauri::AppHandle, shared: &ScanShared) {
    use tauri::Emitter;
    let _ = app.emit("space:progress", &ScanProgress {
        scanned: shared.entries.load(Ordering::Relaxed) as u64,
        current_path: String::new(),
    });
}

/// 分析 root 的直接子项占用分布（钻取：对任意子目录再调一次即可）
pub fn scan_children(app: Option<&tauri::AppHandle>, root: &str) -> Result<ScanResult, String> {
    let root_path = Path::new(root);
    if !root_path.exists() {
        return Err(format!("路径不存在：{}", root));
    }
    crate::clear_token(SCAN_TOKEN);
    let deadline = Instant::now() + Duration::from_secs(600); // 10 分钟保险丝
    let shared = ScanShared {
        entries: AtomicUsize::new(0),
        cancelled: std::sync::atomic::AtomicBool::new(false),
        top: Mutex::new(BinaryHeap::new()),
    };

    // 收集直接子项
    let mut children_paths: Vec<PathBuf> = Vec::new();
    let rd = std::fs::read_dir(root_path).map_err(|e| e.to_string())?;
    for entry in rd.flatten() {
        if crate::is_cancelled(SCAN_TOKEN) { break; }
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() { continue; }
        children_paths.push(entry.path());
    }

    // 并发统计每棵子树
    let next = AtomicUsize::new(0);
    let collected: Mutex<Vec<DirStat>> = Mutex::new(Vec::new());
    let workers = children_paths.len().min(WORKERS).max(1);
    std::thread::scope(|s| {
        for _ in 0..workers {
            s.spawn(|| loop {
                if crate::is_cancelled(SCAN_TOKEN) { break; }
                let i = next.fetch_add(1, Ordering::SeqCst);
                if i >= children_paths.len() { break; }
                let p = &children_paths[i];
                let stat = if p.is_dir() {
                    walk_tree(p, &shared, app, deadline)
                } else {                    let size = p.metadata().map(|m| m.len()).unwrap_or(0);
                    shared.record_file(p, &p.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(), size);
                    DirStat {
                        path: p.to_string_lossy().to_string(),
                        name: p.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
                        size, files: 1, dirs: 0, is_dir: false, partial: false,
                    }
                };
                collected.lock().unwrap().push(stat);
            });
        }
    });

    let cancelled = crate::is_cancelled(SCAN_TOKEN);
    crate::clear_token(SCAN_TOKEN);
    let mut children = collected.into_inner().unwrap();
    children.sort_by(|a, b| b.size.cmp(&a.size));
    let top_files = std::mem::take(&mut *shared.top.lock().unwrap())
        .into_vec()
        .into_iter()
        .map(|Reverse((size, path, name))| DirStat {
            path, name, size, files: 1, dirs: 0, is_dir: false, partial: false,
        })
        .collect::<Vec<_>>();
    Ok(ScanResult {
        root: root.to_string(),
        total_size: children.iter().map(|c| c.size).sum(),
        total_files: children.iter().map(|c| c.files).sum(),
        total_dirs: children.iter().map(|c| c.dirs).sum(),
        scanned_entries: shared.entries.load(Ordering::Relaxed) as u64,
        cancelled,
        children,
        top_files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_children_counts_sizes() {
        let tmp = std::env::temp_dir().join(format!("ff_space_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let sub = tmp.join("big");
        std::fs::create_dir_all(sub.join("nested")).unwrap();
        std::fs::write(tmp.join("loose.bin"), vec![0u8; 100]).unwrap();
        std::fs::write(sub.join("a.bin"), vec![0u8; 2000]).unwrap();
        std::fs::write(sub.join("nested").join("b.bin"), vec![0u8; 500]).unwrap();
        let r = scan_children(None, tmp.to_str().unwrap()).unwrap();
        let _ = std::fs::remove_dir_all(&tmp);
        assert_eq!(r.total_size, 2600);
        assert!(!r.cancelled);
        let big = r.children.iter().find(|c| c.name == "big").unwrap();
        assert_eq!(big.size, 2500);
        assert_eq!(big.files, 2);
        assert_eq!(big.dirs, 1);
        assert!(r.top_files.iter().any(|f| f.name == "a.bin" && f.size == 2000));
        assert!(r.children[0].size >= r.children.last().unwrap().size, "按大小降序");
    }

    #[test]
    fn scan_missing_root_errors() {
        let r = scan_children(None, "Z:\\__ff_not_exist__");
        assert!(r.is_err());
    }
}
