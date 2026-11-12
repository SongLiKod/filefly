// tag 命令层（F-19~F-21）
use crate::tags::store;
use tauri::State;
type S<'a> = State<'a, crate::AppState>;

#[tauri::command]
pub async fn tag_list(state: S<'_>) -> Result<Vec<store::TagDef>, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || Ok(store::list_defs(&db)))
        .await
        .map_err(|e| e.to_string())?
}

/// 设置文件全部标签（双写：ADS + SQLite，技术文档 §5.1）
#[tauri::command]
pub async fn tag_set(path: String, tags: Vec<String>, state: S<'_>) -> Result<(), String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || store::write_all(&db, &path, &tags))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn tag_add(path: String, tag: String, state: S<'_>) -> Result<(), String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut tags = store::read_merged(&db, &path);
        if !tags.contains(&tag) { tags.push(tag); }
        store::write_all(&db, &path, &tags)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn tag_remove(path: String, tag: String, state: S<'_>) -> Result<(), String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut tags = store::read_merged(&db, &path);
        tags.retain(|t| t != &tag);
        store::write_all(&db, &path, &tags)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 按标签跨路径聚合（F-21）：返回目录信息与真实 stat，前端行展示与目录浏览完全一致
#[derive(serde::Serialize)]
pub struct TaggedPath {
    pub path: String,
    pub tags: Vec<String>,
    pub is_dir: bool,
    pub mtime: i64,
    pub size: u64,
}

#[tauri::command]
pub async fn tag_files_of(tag: String, state: S<'_>) -> Result<Vec<TaggedPath>, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let rows = store::files_of_tag(&db, &tag);
        Ok(rows
            .into_iter()
            .map(|(p, tags)| {
                let (is_dir, mtime, size) = match std::fs::metadata(&p) {
                    Ok(m) => (
                        m.is_dir(),
                        m.modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as i64)
                            .unwrap_or(0),
                        if m.is_dir() { 0 } else { m.len() },
                    ),
                    Err(_) => (false, 0, 0), // 已删除/不可访问：按失效文件展示
                };
                TaggedPath { path: p, tags, is_dir, mtime, size }
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

// 标签定义增删改（用户需求：标签可新建/重命名/删除/改色）
#[tauri::command]
pub async fn tag_def_create(name: String, color: String, state: S<'_>) -> Result<(), String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let name = name.trim().to_string();
        if name.is_empty() { return Err("标签名不能为空".to_string()); }
        let sort = store::list_defs(&db).len() as i32 + 1;
        store::create_def(&db, &name, &color, sort)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn tag_def_rename(old_name: String, new_name: String, state: S<'_>) -> Result<(), String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || store::rename_def(&db, &old_name, &new_name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn tag_def_delete(name: String, state: S<'_>) -> Result<(), String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || store::delete_def(&db, &name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn tag_def_set_color(name: String, color: String, state: S<'_>) -> Result<(), String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || store::set_def_color(&db, &name, &color))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn tag_archive_rule(tag: String, dest_dir: String, state: S<'_>) -> Result<(), String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || store::upsert_rule(&db, &tag, &dest_dir))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn tag_apply_archive(tag: String, state: S<'_>) -> Result<u32, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || store::apply_archive_rule(&db, &tag))
        .await
        .map_err(|e| e.to_string())?
}
