// SQLite 双写与合并（技术文档 §5.1）：非 NTFS 兜底 + 冲突取并集 + 移动指纹迁移
use super::ads;
use crate::index::db::Db;
use rusqlite::params;
use std::path::Path;

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TagDef {
    pub name: String,
    pub color: String, // 8 色预设之一（主题 tokens.json tagPresetColors）
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TagRule {
    pub tag: String,
    pub dest_dir: String, // 如 tag:发票 → 自动入 D:/票据/
}

/// 读取某文件全部标签（合并规则：ADS 优先，SQLite 兜底，双处冲突取并集）
pub fn read_merged(db: &Db, path: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if let Some(ads_tags) = ads::read_tags(path) {
        for t in ads_tags {
            if !out.contains(&t) { out.push(t); }
        }
    }
    if let Some(conn) = db.conn.try_lock() {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT tag FROM file_tags WHERE path = ?1 ORDER BY created_at",
        ) {
            if let Ok(rows) = stmt.query_map(params![path], |r| r.get::<_, String>(0)) {
                for t in rows.flatten() {
                    if !out.contains(&t) { out.push(t); }
                }
            }
        }
    }
    out
}

/// 写标签 = 双写（NTFS → ADS + SQLite；非 NTFS → 仅 SQLite，占位符文件仅 SQLite）
pub fn write_all(db: &Db, path: &str, tags: &[String]) -> Result<(), String> {
    let mut conn = db.conn.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM file_tags WHERE path = ?1", params![path]).map_err(|e| e.to_string())?;
    for t in tags {
        tx.execute(
            "INSERT OR IGNORE INTO file_tags(path, tag, created_at) VALUES(?1, ?2, strftime('%s','now'))",
            params![path, t],
        ).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);

    let placeholder = is_placeholder(path);
    if !placeholder && ads::is_ntfs(path) {
        // 写 ADS 失败不视为致命（有 SQLite 兜底）
        let _ = ads::write_tags(path, tags);
    }
    Ok(())
}

/// OneDrive on-demand 占位符：读 ADS 会触发下载 → 降级为仅 SQLite（技术文档 §13 风险 5）
fn is_placeholder(path: &str) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        std::fs::metadata(path)
            .map(|m| m.file_attributes() & 0x400000 != 0 || m.file_attributes() & 0x1000 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    { let _ = path; false }
}

/// 路径不存在但指纹 (size+mtime+名称哈希) 匹配 → 视为移动，自动迁移标签记录
pub fn migrate_if_moved(db: &Db, old_path: &str, new_path: &str) {
    let conn = db.conn.lock();
    let _ = conn.execute(
        "UPDATE OR REPLACE file_tags SET path = ?1 WHERE path = ?2",
        params![new_path, old_path],
    );
    let _ = conn.execute(
        "UPDATE OR REPLACE recent_items SET path = ?1 WHERE path = ?2",
        params![new_path, old_path],
    );
}

/// 标签定义 CRUD（预设 8 色 + 自定义）
pub fn list_defs(db: &Db) -> Vec<TagDef> {
    let mut out = Vec::new();
    let conn = db.conn.lock();
    if let Ok(mut stmt) = conn.prepare("SELECT name, color FROM tag_defs ORDER BY sort") {
        if let Ok(rows) = stmt.query_map([], |r| Ok(TagDef { name: r.get(0)?, color: r.get(1)? })) {
            for r in rows.flatten() { out.push(r); }
        }
    }
    out
}

/// 仅读 SQLite 侧标签（不含 ADS，用于改写 ADS 前取权威数据）
fn read_sqlite(db: &Db, path: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if let Some(conn) = db.conn.try_lock() {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT tag FROM file_tags WHERE path = ?1 ORDER BY created_at",
        ) {
            if let Ok(rows) = stmt.query_map(params![path], |r| r.get::<_, String>(0)) {
                for t in rows.flatten() {
                    if !out.contains(&t) { out.push(t); }
                }
            }
        }
    }
    out
}

pub fn upsert_def(db: &Db, name: &str, color: &str, sort: i32) -> Result<(), String> {
    db.conn.lock()
        .execute(
            "INSERT INTO tag_defs(name, color, sort) VALUES(?1,?2,?3)
             ON CONFLICT(name) DO UPDATE SET color=?2",
            params![name, color, sort],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 新建标签定义
pub fn create_def(db: &Db, name: &str, color: &str, sort: i32) -> Result<(), String> {
    db.conn.lock()
        .execute(
            "INSERT INTO tag_defs(name, color, sort) VALUES(?1,?2,?3)",
            params![name, color, sort],
        )
        .map(|_| ())
        .map_err(|e| if e.to_string().contains("UNIQUE") { "标签已存在".to_string() } else { e.to_string() })
}

/// 修改标签颜色
pub fn set_def_color(db: &Db, name: &str, color: &str) -> Result<(), String> {
    let n = db.conn.lock()
        .execute("UPDATE tag_defs SET color = ?2 WHERE name = ?1", params![name, color])
        .map_err(|e| e.to_string())?;
    if n == 0 { Err("标签不存在".into()) } else { Ok(()) }
}

/// 重命名标签：级联更新 tag_defs + file_tags，并重写受影响文件的 ADS
pub fn rename_def(db: &Db, old: &str, new: &str) -> Result<(), String> {
    let new = new.trim().to_string();
    if new.is_empty() { return Err("标签名不能为空".into()); }
    if old == new { return Ok(()); }
    // 先收集受影响路径（改名前）
    let paths: Vec<String> = {
        let conn = db.conn.lock();
        let mut v = Vec::new();
        if let Ok(mut stmt) = conn.prepare("SELECT path FROM file_tags WHERE tag = ?1") {
            if let Ok(rows) = stmt.query_map(params![old], |r| r.get::<_, String>(0)) {
                for p in rows.flatten() { v.push(p); }
            }
        }
        v
    };
    {
        let conn = db.conn.lock();
        // 定义表：改名（若新名已存在则仅删除旧名，标签合并到已有定义）
        conn.execute(
            "INSERT INTO tag_defs(name, color, sort) SELECT ?2, color, sort FROM tag_defs WHERE name = ?1
             ON CONFLICT(name) DO NOTHING",
            params![old, new],
        ).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM tag_defs WHERE name = ?1", params![old]).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE OR REPLACE file_tags SET tag = ?2 WHERE tag = ?1",
            params![old, new],
        ).map_err(|e| e.to_string())?;
    }
    // 重写受影响文件的 ADS（以 SQLite 为准，去掉旧名）
    for p in &paths {
        let tags = read_sqlite(db, p);
        if ads::is_ntfs(p) { let _ = ads::write_tags(p, &tags); }
    }
    Ok(())
}

/// 删除标签：级联删除 tag_defs + file_tags，并清除受影响文件 ADS 中的该标签
pub fn delete_def(db: &Db, name: &str) -> Result<(), String> {
    let paths: Vec<String> = {
        let conn = db.conn.lock();
        let mut v = Vec::new();
        if let Ok(mut stmt) = conn.prepare("SELECT path FROM file_tags WHERE tag = ?1") {
            if let Ok(rows) = stmt.query_map(params![name], |r| r.get::<_, String>(0)) {
                for p in rows.flatten() { v.push(p); }
            }
        }
        v
    };
    {
        let conn = db.conn.lock();
        conn.execute("DELETE FROM tag_defs WHERE name = ?1", params![name]).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM file_tags WHERE tag = ?1", params![name]).map_err(|e| e.to_string())?;
    }
    for p in &paths {
        let tags = read_sqlite(db, p);
        if ads::is_ntfs(p) { let _ = ads::write_tags(p, &tags); }
    }
    Ok(())
}

/// 按标签跨路径聚合（F-21）：SQLite 全量 + ADS 侧由 MFT/枚举扫描补充（上层合并去重）
pub fn files_of_tag(db: &Db, tag: &str) -> Vec<(String, Vec<String>)> {
    let mut paths = Vec::new();
    {
        let conn = db.conn.lock();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT path FROM file_tags WHERE tag = ?1 ORDER BY created_at DESC LIMIT 10000",
        ) {
            if let Ok(rows) = stmt.query_map(params![tag], |r| r.get::<_, String>(0)) {
                for p in rows.flatten() { paths.push(p); }
            }
        };
    }
    paths.into_iter()
        .map(|p| { let tags = read_merged(db, &p); (p, tags) })
        .collect()
}

/// 归档规则 CRUD（F-21：tag:发票 → 自动入 D:/票据/）
pub fn list_rules(db: &Db) -> Vec<TagRule> {
    let mut out = Vec::new();
    let conn = db.conn.lock();
    if let Ok(mut stmt) = conn.prepare("SELECT tag, dest_dir FROM tag_rules ORDER BY id") {
        if let Ok(rows) = stmt.query_map([], |r| Ok(TagRule { tag: r.get(0)?, dest_dir: r.get(1)? })) {
            for r in rows.flatten() { out.push(r); }
        }
    }
    out
}

pub fn upsert_rule(db: &Db, tag: &str, dest: &str) -> Result<(), String> {
    db.conn.lock()
        .execute(
            "INSERT INTO tag_rules(tag, dest_dir) VALUES(?1,?2)
             ON CONFLICT(tag) DO UPDATE SET dest_dir=?2",
            params![tag, dest],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 执行归档规则：将打该标签的文件移动至目标目录
pub fn apply_archive_rule(db: &Db, tag: &str) -> Result<u32, String> {
    let dest = list_rules(db).into_iter().find(|r| r.tag == tag).map(|r| r.dest_dir);
    let dest = match dest { Some(d) => d, None => return Ok(0) };
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let files = files_of_tag(db, tag);
    let mut moved = 0u32;
    for (p, _) in &files {
        let src = Path::new(p);
        if !src.exists() { continue; }
        let name = src.file_name().unwrap_or_default();
        let dst = Path::new(&dest).join(name);
        if std::fs::rename(src, &dst).is_ok() {
            let dst_str = dst.to_string_lossy().to_string();
            migrate_if_moved(db, p, &dst_str);
            moved += 1;
        }
    }
    Ok(moved)
}
