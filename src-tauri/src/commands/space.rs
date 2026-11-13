// 空间分析/清理命令层（用户需求：磁盘占用分析 + 清理）
// 安全纪律：清理目标只允许内置白名单 id（杜绝前端传任意路径删除）；
// 只删除目标目录的"内容"，永不删除目录本身；失败项逐条上报，不中断。
use crate::fs::space::{self, ScanResult, SCAN_TOKEN};
use crate::fs::trash;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

type S<'a> = tauri::State<'a, crate::AppState>;

/// 清理项扫描取消令牌（与空间分析扫描令牌独立）
pub const CLEAN_SCAN_TOKEN: &str = "clean-scan";

#[tauri::command]
pub async fn fs_space_scan(root: String, app: AppHandle) -> Result<ScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || space::scan_children(Some(&app), &root))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn fs_space_cancel() {
    crate::cancel_token(SCAN_TOKEN);
}

// ---------------- 清理目标（内置白名单） ----------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CleanTarget {
    pub id: String,
    pub name: String,
    pub description: String,
    /// 解析后的实际路径（可能有多个，如浏览器多 Profile）
    pub paths: Vec<String>,
    pub size: u64,
    pub partial: bool,
    pub cleanable: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CleanReport {
    pub freed: u64,
    pub failed: Vec<String>,
}

/// 内置清理目标定义。id 即白名单键，execute 只认这里的 id。
fn preset_targets() -> Vec<(&'static str, &'static str, &'static str, Vec<PathBuf>)> {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let win = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
    let mut v: Vec<(&'static str, &'static str, &'static str, Vec<PathBuf>)> = vec![
        ("temp_user", "用户临时文件", "应用安装包解压、日志等临时残留，位于 %LOCALAPPDATA%\\Temp",
            vec![PathBuf::from(&local).join("Temp")]),
        ("temp_windows", "系统临时文件", "C:\\Windows\\Temp，部分系统文件可能无权限，自动跳过",
            vec![PathBuf::from(&win).join("Temp")]),
        ("edge_cache", "Edge 浏览器缓存", "网页缓存/Code Cache（不含密码、书签、历史）", vec![]),
        ("chrome_cache", "Chrome 浏览器缓存", "网页缓存/Code Cache（不含密码、书签、历史）", vec![]),
        ("firefox_cache", "Firefox 缓存", "Profiles 下的 cache2（不含配置与书签）", vec![]),
        ("thumbnails", "缩略图缓存", "Explorer thumbcache 数据库，重建后文件夹预览会重新生成", vec![]),
        ("crash_dumps", "崩溃转储", "%LOCALAPPDATA%\\CrashDumps 的 .dmp 文件", vec![PathBuf::from(&local).join("CrashDumps")]),
        ("npm_cache", "npm 缓存", "%LOCALAPPDATA%\\npm-cache", vec![PathBuf::from(&local).join("npm-cache")]),
        ("pip_cache", "pip 缓存", "%LOCALAPPDATA%\\pip\\cache", vec![PathBuf::from(&local).join("pip").join("cache")]),
        ("recycle_bin", "回收站", "清空回收站（等同系统「清空回收站」，不可恢复）", vec![]),
    ];
    // 浏览器多 Profile：User Data/*/Cache 与 */Code Cache
    for (id, base) in [
        ("edge_cache", PathBuf::from(&local).join("Microsoft").join("Edge").join("User Data")),
        ("chrome_cache", PathBuf::from(&local).join("Google").join("Chrome").join("User Data")),
    ] {
        if let Ok(rd) = std::fs::read_dir(&base) {
            for e in rd.flatten() {
                if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    for sub in ["Cache", "Code Cache"] {
                        let p = e.path().join(sub);
                        if p.exists() {
                            if let Some(t) = v.iter_mut().find(|t| t.0 == id) { t.3.push(p); }
                        }
                    }
                }
            }
        }
    }
    if let Ok(rd) = std::fs::read_dir(PathBuf::from(&local).join("Mozilla").join("Firefox").join("Profiles")) {
        for e in rd.flatten() {
            let p = e.path().join("cache2");
            if p.exists() {
                if let Some(t) = v.iter_mut().find(|t| t.0 == "firefox_cache") { t.3.push(p); }
            }
        }
    }
    let thumb_dir = PathBuf::from(&local).join("Microsoft").join("Windows").join("Explorer");
    if thumb_dir.exists() {
        if let Some(t) = v.iter_mut().find(|t| t.0 == "thumbnails") {
            t.3 = std::fs::read_dir(&thumb_dir).map(|rd| rd.flatten()
                .filter(|e| e.file_name().to_string_lossy().starts_with("thumbcache_"))
                .map(|e| e.path()).collect()).unwrap_or_default();
        }
    }
    v
}

/// 清理项扫描结果（cancelled 标记用户中途取消，结果不完整）
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CleanTargetsResult {
    pub targets: Vec<CleanTarget>,
    pub cancelled: bool,
}

/// 并行测量各目标大小（每目标 8s deadline，超时 partial）。
/// 实时性：目标开始/完成各发一条 clean:progress；测量中每 100 目录上报当前路径。
#[tauri::command]
pub async fn fs_clean_targets(app: AppHandle) -> Result<CleanTargetsResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::clear_token(CLEAN_SCAN_TOKEN);
        let presets = preset_targets();
        let total = presets.len();
        let next = AtomicUsize::new(0);
        let collected: Mutex<Vec<CleanTarget>> = Mutex::new(Vec::new());
        let cancelled = std::sync::atomic::AtomicBool::new(false);
        let workers = presets.len().min(8);
        std::thread::scope(|s| {
            for _ in 0..workers {
                s.spawn(|| loop {
                    if crate::is_cancelled(CLEAN_SCAN_TOKEN) {
                        cancelled.store(true, Ordering::Relaxed);
                        break;
                    }
                    let i = next.fetch_add(1, Ordering::SeqCst);
                    if i >= presets.len() { break; }
                    let (id, name, desc, paths) = &presets[i];
                    let _ = app.emit("clean:progress", serde_json::json!({
                        "kind": "start", "index": i + 1, "total": total, "name": name,
                    }));
                    let deadline = Instant::now() + Duration::from_secs(8);
                    let mut size = 0u64;
                    let mut partial = false;
                    let app2 = &app;
                    if id != &"recycle_bin" {
                        for p in paths {
                            let (s, pt) = measure_path(Path::new(p), deadline,
                                || crate::is_cancelled(CLEAN_SCAN_TOKEN),
                                &|d: &Path| {
                                    let _ = app2.emit("clean:progress", serde_json::json!({
                                        "kind": "dir", "name": name, "dir": d.to_string_lossy(),
                                    }));
                                });
                            size += s;
                            partial |= pt;
                        }
                    } else {
                        size = trash::total_size().unwrap_or(0);
                    }
                    let t = CleanTarget {
                        id: id.to_string(), name: name.to_string(), description: desc.to_string(),
                        paths: paths.iter().map(|p| p.to_string_lossy().to_string()).collect(),
                        size, partial, cleanable: size > 0,
                    };
                    // 单个目标完成即实时推送，前端边扫边显示
                    let _ = app.emit("clean:target", serde_json::json!(t));
                    let _ = app.emit("clean:progress", serde_json::json!({
                        "kind": "done", "index": i + 1, "total": total, "name": name,
                    }));
                    collected.lock().unwrap().push(t);
                    if crate::is_cancelled(CLEAN_SCAN_TOKEN) {
                        cancelled.store(true, Ordering::Relaxed);
                    }
                });
            }
        });
        let cancelled = cancelled.load(Ordering::Relaxed);
        let mut out = collected.into_inner().unwrap();
        out.sort_by(|a, b| b.size.cmp(&a.size));
        Ok(CleanTargetsResult { targets: out, cancelled })
    }).await.map_err(|e| e.to_string())?
}

/// 取消清理项扫描
#[tauri::command]
pub fn fs_clean_targets_cancel() {
    crate::cancel_token(CLEAN_SCAN_TOKEN);
}

/// 测量路径大小（迭代栈，同 scan 引擎纪律；支持取消与当前目录回调）
fn measure_path(root: &Path, deadline: Instant, cancelled: impl Fn() -> bool, on_dir: &dyn Fn(&Path)) -> (u64, bool) {
    let mut total = 0u64;
    let mut partial = false;
    let mut seen = 0usize;
    let mut stack = vec![root.to_path_buf()];
    'outer: while let Some(dir) = stack.pop() {
        if cancelled() || Instant::now() >= deadline { partial = true; break; }
        seen += 1;
        if seen % 100 == 0 { on_dir(&dir); }
        let rd = match std::fs::read_dir(&dir) { Ok(r) => r, Err(_) => continue };
        for entry in rd.flatten() {
            if cancelled() || Instant::now() >= deadline { partial = true; break 'outer; }
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_symlink() { continue; }
            if ft.is_dir() { stack.push(entry.path()); }
            else { total += entry.metadata().map(|m| m.len()).unwrap_or(0); }
        }
    }
    (total, partial)
}

/// 执行清理：只认内置白名单 id；删内容不删目录；逐条上报失败
#[tauri::command]
pub async fn fs_clean_execute(ids: Vec<String>, app: AppHandle) -> Result<CleanReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let presets = preset_targets();
        let mut report = CleanReport { freed: 0, failed: vec![] };
        for id in &ids {
            let Some((_, name, _, paths)) = presets.iter().find(|t| &t.0 == id) else {
                report.failed.push(format!("{}：非内置清理目标，已拒绝", id));
                continue;
            };
            let _ = app.emit("clean:progress", serde_json::json!({ "target": name, "status": "running" }));
            if id == "recycle_bin" {
                let before = trash::total_size().unwrap_or(0);
                match trash::empty_all() {
                    Ok(_) => report.freed += before,
                    Err(e) => report.failed.push(format!("{}：{}", name, e)),
                }
                continue;
            }
            for p in paths {
                let Ok(rd) = std::fs::read_dir(p) else { continue };
                for entry in rd.flatten() {
                    let path = entry.path();
                    // 删除前先测量（被锁文件删除失败不计 freed）
                    let (size, _) = measure_path(&path, Instant::now() + Duration::from_secs(5),
                        || false, &|_| {});
                    let r = if path.is_dir() {
                        std::fs::remove_dir_all(&path)
                    } else {
                        std::fs::remove_file(&path)
                    };
                    match r {
                        Ok(_) => report.freed += size,
                        Err(e) => report.failed.push(format!(
                            "{}：{}（{}）", name, path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(), e)),
                    }
                }
            }
            let _ = app.emit("clean:progress", serde_json::json!({ "target": name, "status": "done" }));
        }
        Ok(report)
    }).await.map_err(|e| e.to_string())?
}

// 供单测使用：白名单校验逻辑
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whitelist_rejects_unknown_ids() {
        let presets = preset_targets();
        let ids = vec!["temp_user".to_string(), "C:\\Users".to_string()];
        let mut rejected = 0;
        for id in &ids {
            if !presets.iter().any(|t| &t.0 == id) { rejected += 1; }
        }
        assert_eq!(rejected, 1, "任意路径必须被白名单拒绝");
        assert!(presets.iter().any(|t| t.0 == "temp_user"));
        assert!(presets.iter().all(|t| !t.3.iter().any(|p| p.as_os_str().is_empty())));
    }

    #[test]
    fn targets_have_unique_ids() {
        let presets = preset_targets();
        let mut ids: Vec<&str> = presets.iter().map(|t| t.0).collect();
        ids.sort();
        let n = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), n, "清理目标 id 不得重复");
    }
}
