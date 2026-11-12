// settings 命令层：视图偏好、主题、缩略图并发等
use tauri::State;
type S<'a> = State<'a, crate::AppState>;

#[tauri::command]
pub async fn settings_get(key: String, state: S<'_>) -> Result<Option<serde_json::Value>, String> {
    if let Some(v) = state.settings.lock().get(&key) {
        return Ok(Some(v.clone()));
    }
    let conn = state.db.conn.lock();
    let v: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", rusqlite::params![key], |r| r.get(0))
        .ok();
    Ok(v.and_then(|s| serde_json::from_str(&s).ok()))
}

#[tauri::command]
pub async fn settings_set(key: String, value: serde_json::Value, state: S<'_>) -> Result<(), String> {
    state.settings.lock().insert(key.clone(), value.clone());
    state
        .db
        .conn
        .lock()
        .execute(
            "INSERT INTO settings(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = ?2",
            rusqlite::params![key, serde_json::to_string(&value).unwrap()],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}
