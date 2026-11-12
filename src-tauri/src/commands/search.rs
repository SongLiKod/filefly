// search 命令层（F-09~F-12）：前端 QueryAST → Rust SQL，目标 P99 ≤ 100ms（§10）
use crate::index::db::QueryAst;
use crate::index::scanner;
use serde::Deserialize;
use tauri::State;
type S<'a> = State<'a, crate::AppState>;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct QueryInput {
    pub text: String,
    pub ext: Option<String>,
    pub min_size: Option<u64>,
    pub max_size: Option<u64>,
    pub modified: Option<String>, // today | week | month
    pub tag: Option<String>,
    pub is_dir: Option<bool>,
}

#[tauri::command]
pub async fn search_query(q: QueryInput, limit: Option<usize>, state: S<'_>) -> Result<Vec<crate::index::db::SearchHit>, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut ast = QueryAst {
            text: q.text.clone(),
            fts_match: build_fts_match(&q.text),
            ext: q.ext,
            min_size: q.min_size,
            max_size: q.max_size,
            mtime_after: modified_to_epoch(&q.modified),
            is_dir: q.is_dir,
        };
        let _ = &mut ast;
        // tag 过滤：先查 tag_files_of 再交集（F-11 tag:工作）
        let hits = scanner::run_query(&db, &ast, limit.unwrap_or(500)).map_err(|e| e.to_string())?;
        // 索引未命中 → 实时兜底扫描（命中项写回索引，下次直接命中）
        let hits = if hits.is_empty() && !ast.text.trim().is_empty() {
            scanner::live_search(&db, &ast, limit.unwrap_or(500))
        } else {
            hits
        };
        if let Some(tag) = &q.tag {
            let tagged: std::collections::HashSet<String> =
                crate::tags::store::files_of_tag(&db, tag).into_iter().map(|(p, _)| p).collect();
            let mut conn = db.conn.lock();
            let _ = &mut conn;
            let filtered: Vec<_> = hits
                .into_iter()
                .filter(|h| tagged.contains(&h.path))
                .collect();
            // 回填路径（索引 path 列）
            return Ok(filtered);
        }
        // 回填 path 列（files.path）
        fill_paths(&db, hits).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn fill_paths(db: &crate::index::db::Db, mut hits: Vec<crate::index::db::SearchHit>) -> anyhow::Result<Vec<crate::index::db::SearchHit>> {
    let conn = db.conn.lock();
    for h in &mut hits {
        if h.path.is_empty() {
            if let Ok(p) = conn.query_row(
                "SELECT path FROM files WHERE name = ?1 LIMIT 1",
                rusqlite::params![h.name],
                |r| r.get::<_, Option<String>>(0),
            ) {
                h.path = p.unwrap_or_default();
            }
        }
    }
    Ok(hits)
}

/// FTS5 MATCH 语法组装：中文按字 AND 前缀匹配，ASCII 词按前缀
fn build_fts_match(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let has_cjk = trimmed.chars().any(|c| (c as u32) >= 0x4E00 && (c as u32) <= 0x9FFF);
    if has_cjk {
        trimmed
            .chars()
            .filter(|c| !c.is_whitespace())
            .map(|c| format!("\"{}\"*", c))
            .collect::<Vec<_>>()
            .join(" AND ")
    } else {
        format!("\"{}\"*", trimmed.replace('"', ""))
    }
}

fn modified_to_epoch(m: &Option<String>) -> Option<i64> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as i64;
    match m.as_deref() {
        Some("today") => Some(now - 24 * 3600 * 1000),
        Some("week") => Some(now - 7 * 24 * 3600 * 1000),
        Some("month") => Some(now - 30 * 24 * 3600 * 1000),
        _ => None,
    }
}

/// 索引状态（首页/搜索框展示「索引中…」）
#[tauri::command]
pub async fn search_status() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "ready": scanner::INDEX_READY.load(std::sync::atomic::Ordering::Relaxed),
        "engine": "FTS5",
    }))
}
