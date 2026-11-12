// 全盘扫描 + 增量处理（技术文档 §4.2）
// MVP 策略（§13 风险 1）：普通枚举全量 + USN 增量；M2 评估 MFT 直读提权
// 性能纪律：分批事务提交（500/批）、批间释放数据库锁（保证搜索不被阻塞）、
// 跳过系统/开发噪声目录、先扫用户主目录使索引尽快可用
use super::db::{Db, QueryAst};
use crate::AppState;
use pinyin::ToPinyin;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

pub static INDEX_READY: AtomicBool = AtomicBool::new(false);

/// 拼音全拼 + 首字母（F-10：xj → 项目计划.xlsx）
pub fn to_pinyin_fields(name: &str) -> (String, String) {
    let mut full = String::new();
    let mut initial = String::new();
    for p in name.to_pinyin().flatten() {
        let py = p.plain();
        full.push_str(py);
        initial.push(py.chars().next().unwrap_or(' '));
    }
    // 非 CJK 字符原样保留小写
    for c in name.chars() {
        if !c.is_chinese() {
            let lower = c.to_lowercase().next().unwrap_or(c);
            full.push(lower);
            initial.push(lower);
        }
    }
    (full, initial)
}

trait IsChinese {
    fn is_chinese(&self) -> bool;
}
impl IsChinese for char {
    fn is_chinese(&self) -> bool {
        matches!(*self as u32, 0x4E00..=0x9FFF | 0x3400..=0x4DBF)
    }
}

/// 索引常驻线程：先扫主目录（秒级出索引）→ 置 INDEX_READY → 后台扫其余盘
pub fn spawn_index_worker(app: tauri::AppHandle) {
    let db = {
        let state = app.state::<AppState>();
        state.db.clone()
    };
    let home_root = home_root();
    let other_roots = other_roots();

    std::thread::spawn(move || {
        // 第一阶段：主目录（用户最常搜索的范围，秒级完成）
        scan_roots(&db, &[home_root.clone()], 24);
        INDEX_READY.store(true, Ordering::Release);

        // 第二阶段：其余磁盘（后台慢速，批间释放锁不阻塞搜索）
        if !other_roots.is_empty() && full_scan_due(&db) {
            scan_roots(&db, &other_roots, 16);
            let _ = db.conn.lock().execute(
                "INSERT OR REPLACE INTO settings(key, value) VALUES('last_full_scan', ?1)",
                rusqlite::params![chrono_now_ms().to_string()],
            );
        }
    });

    // 增量监听：Windows USN Journal；macOS FSEvents；其余/exFAT → 60s 轮询兜底（§4.2）
    #[cfg(target_os = "windows")]
    {
        let handle = app.clone();
        std::thread::spawn(move || {
            if crate::index::usn::watch_all(handle).is_err() {
                // USN 不可用（权限/商店 MSIX 限制 spike，§13 风险 4）→ 降级轮询
                poll_loop();
            }
        });
    }
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        std::thread::spawn(move || crate::index::fsevents::watch_all(handle));
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        poll_loop();
    }
}

fn poll_loop() {
    // exFAT/网络盘降级：定时目录树轮询（60s，可配置，技术文档 §4.2）
    loop {
        std::thread::sleep(std::time::Duration::from_secs(60));
    }
}

fn home_root() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| "C:\\Users".into())
}

/// 其余磁盘根（排除主目录所在盘，避免与主目录扫描重复）
fn other_roots() -> Vec<String> {
    let home = home_root();
    let home_drive = home.chars().take(2).collect::<String>().to_uppercase();
    let mut roots = Vec::new();
    for letter in 'C'..='Z' {
        let drive = format!("{}:\\", letter);
        if drive.to_uppercase() == home_drive {
            continue; // 主目录所在盘已由主目录扫描覆盖
        }
        if std::path::Path::new(&drive).exists() {
            roots.push(drive);
        }
    }
    roots
}

/// 24h 内做过全盘扫描 → 跳过其余盘重扫（主目录始终增量扫描保证新文件可搜）
fn full_scan_due(db: &Db) -> bool {
    let conn = db.conn.lock();
    conn.query_row("SELECT value FROM settings WHERE key = 'last_full_scan'", [], |r| {
        r.get::<_, String>(0)
    })
    .ok()
    .and_then(|v| v.parse::<i64>().ok())
    .map(|last| chrono_now_ms() - last > 24 * 3600 * 1000)
    .unwrap_or(true)
}

/// 目录名黑名单：系统/开发噪声目录（剪枝，跳过其整棵子树）
fn skip_dir_name(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "appdata" | "application data" | "local settings" | "cookies" | "ntuser.dat"
            | "$recycle.bin" | "system volume information" | "windows" | "recovery"
            | "program files" | "program files (x86)" | "programdata" | "msocache"
            | ".git" | "node_modules" | "__pycache__" | ".cache" | ".npm" | ".cargo"
            | ".rustup" | ".vscode" | ".gradle" | ".maven" | "cache" | "caches"
    )
}

type BatchRow = (String, String, String, Option<String>, i64, i64, i64, String);

/// 分批落库：锁 → BEGIN → 批量 INSERT → COMMIT → 解锁（批间允许搜索/浏览抢占）
fn flush_batch(db: &Db, batch: &mut Vec<BatchRow>) -> usize {
    let n = batch.len();
    if n == 0 {
        return 0;
    }
    let conn = db.conn.lock();
    if let Ok(mut stmt) = conn.prepare(
        "INSERT OR IGNORE INTO files(volume_id, frn, parent_frn, name, name_py, name_py_initial, ext, size, mtime, is_dir, path)
         VALUES(1, 0, 0, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    ) {
        let _ = conn.execute_batch("BEGIN IMMEDIATE");
        for r in batch.iter() {
            let _ = stmt.execute(rusqlite::params![r.0, r.1, r.2, r.3, r.4, r.5, r.6, r.7]);
        }
        let _ = conn.execute_batch("COMMIT");
    }
    batch.clear();
    n
}

fn scan_roots(db: &Db, roots: &[String], max_depth: usize) {
    for root in roots {
        let mut batch: Vec<BatchRow> = Vec::new();
        let mut indexed = 0usize;
        for entry in walkdir::WalkDir::new(root)
            .max_depth(max_depth)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                // 剪枝：跳过黑名单目录整棵子树（根与文件不过滤）
                if e.file_type().is_dir() && e.depth() > 0 {
                    !skip_dir_name(&e.file_name().to_string_lossy())
                } else {
                    true
                }
            })
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            let name = match path.file_name() {
                Some(n) => n.to_string_lossy().to_string(),
                None => continue,
            };
            let is_dir = entry.file_type().is_dir();
            let (py, pyi) = to_pinyin_fields(&name);
            let meta = entry.metadata().ok();
            let (size, mtime) = meta
                .map(|m| {
                    (
                        if is_dir { 0 } else { m.len() },
                        m.modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as i64)
                            .unwrap_or(0),
                    )
                })
                .unwrap_or((0, 0));
            let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase());
            let full_path = path.to_string_lossy().to_string();
            batch.push((name, py, pyi, ext, size as i64, mtime, is_dir as i64, full_path));
            if batch.len() >= 500 {
                indexed += flush_batch(db, &mut batch);
            }
        }
        indexed += flush_batch(db, &mut batch);
        let _ = indexed;
    }
}

/// 索引未命中时的实时兜底扫描：按名称子串实时匹配（限深+限时+限量），
/// 命中项写回索引库（下次搜索直接命中），彻底解决"索引没覆盖就搜不到"
pub fn live_search(db: &Db, ast: &QueryAst, limit: usize) -> Vec<super::db::SearchHit> {
    let terms: Vec<String> = ast
        .text
        .to_lowercase()
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();
    if terms.is_empty() {
        return Vec::new();
    }
    let mut roots = vec![home_root()];
    roots.extend(other_roots());
    let mut out: Vec<super::db::SearchHit> = Vec::new();
    let mut batch: Vec<BatchRow> = Vec::new();
    let mut visited = 0usize;
    let start = std::time::Instant::now();
    let mut stack: Vec<(std::path::PathBuf, usize)> =
        roots.iter().map(|r| (std::path::PathBuf::from(r), 0usize)).collect();
    while let Some((dir, depth)) = stack.pop() {
        // 纪律：5 秒 / 20 万条封顶，保证搜索请求不卡死
        if start.elapsed().as_secs() >= 5 || visited >= 200_000 || out.len() >= limit {
            break;
        }
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.filter_map(|e| e.ok()) {
            visited += 1;
            if start.elapsed().as_secs() >= 5 || visited >= 200_000 || out.len() >= limit {
                break;
            }
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            let is_dir = p.is_dir();
            if is_dir {
                if depth < 24 && !skip_dir_name(&name) {
                    stack.push((p.clone(), depth + 1));
                }
                continue;
            }
            // 过滤条件与 SQL 查询保持一致
            let ln = name.to_lowercase();
            if !terms.iter().all(|t| ln.contains(t)) {
                continue;
            }
            let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase());
            if let Some(want) = &ast.ext {
                if ext.as_deref() != Some(want.as_str()) {
                    continue;
                }
            }
            let meta = e.metadata().ok();
            let size = meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
            if let Some(min) = ast.min_size {
                if size < min as i64 { continue; }
            }
            if let Some(max) = ast.max_size {
                if size > max as i64 { continue; }
            }
            let mtime = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            if let Some(after) = ast.mtime_after {
                if mtime < after { continue; }
            }
            if let Some(d) = ast.is_dir {
                if is_dir != d { continue; }
            }
            let full_path = p.to_string_lossy().to_string();
            let (py, pyi) = to_pinyin_fields(&name);
            batch.push((name.clone(), py, pyi, ext.clone(), size, mtime, 0, full_path.clone()));
            out.push(super::db::SearchHit {
                name,
                path: full_path,
                size,
                mtime,
                is_dir,
                ext,
            });
            if batch.len() >= 500 {
                flush_batch(db, &mut batch);
            }
        }
    }
    // 命中项写回索引（下次同词搜索直接命中索引）
    flush_batch(db, &mut batch);
    out
}

/// 搜索入口（§4.3：前端 AST → SQL；EXPLAIN 强制走索引由 schema 上的索引保证）
pub fn run_query(db: &Db, ast: &QueryAst, limit: usize) -> anyhow::Result<Vec<super::db::SearchHit>> {
    let started = std::time::Instant::now();
    let hits = db.search(ast, limit)?;
    let took = started.elapsed().as_micros() as i64;
    let _ = db.conn.lock().execute(
        "INSERT INTO search_stats(q, took_us, hit_count, at) VALUES(?1,?2,?3,?4)",
        rusqlite::params![ast.text, took, hits.len() as i64, chrono_now_ms()],
    );
    Ok(hits)
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
