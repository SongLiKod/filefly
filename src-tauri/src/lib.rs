// FileFly 应用装配层：线程模型、状态、command 注册（技术文档 §3）
pub mod commands;
pub mod fs;
pub mod index;
pub mod preview;
pub mod tags;
pub mod thumbs;
pub mod vault;
pub mod theme_tokens;

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

/// 全局应用状态：数据库句柄、缩略图缓存、设置
pub struct AppState {
    pub db: index::db::Db,
    pub settings: Mutex<HashMap<String, serde_json::Value>>,
    pub vault: Mutex<vault::box_::VaultState>,
    pub op_seq: AtomicU64,
}

impl AppState {
    pub fn new() -> anyhow::Result<Self> {
        let data_dir = dirs();
        std::fs::create_dir_all(&data_dir)?;
        let db = index::db::Db::open(data_dir.join("filefly.db"))?;
        Ok(Self {
            db,
            settings: Mutex::new(HashMap::new()),
            vault: Mutex::new(vault::box_::VaultState::Locked),
            op_seq: AtomicU64::new(0),
        })
    }
}

pub fn dirs() -> std::path::PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(home).join(".filefly")
}

/// 显示主窗口（托盘单击 / 菜单"打开 FileFly"共用）
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn next_op_id(app: &tauri::AppHandle) -> u64 {
    app.state::<AppState>().op_seq.fetch_add(1, Ordering::Relaxed)
}

static CANCEL_TOKENS: Lazy<Mutex<HashMap<String, bool>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// 预览/操作取消令牌：切换选中即取消上一个解码任务（技术文档 §3 纪律 4）
pub fn cancel_token(id: &str) {
    CANCEL_TOKENS.lock().insert(id.to_string(), true);
}
pub fn is_cancelled(id: &str) -> bool {
    CANCEL_TOKENS.lock().get(id).copied().unwrap_or(false)
}
pub fn clear_token(id: &str) {
    CANCEL_TOKENS.lock().remove(id);
}

pub fn run() {
    let _app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let state = AppState::new().expect("init state");
            app.manage(state);
            // 启动后台索引线程（全盘扫描 + 增量监听，技术文档 §3 索引线程）
            let handle = app.handle().clone();
            std::thread::spawn(move || index::scanner::spawn_index_worker(handle));

            // 系统托盘：左键单击恢复窗口，右键菜单（打开 / 退出）
            let show = MenuItem::with_id(app, "show", "打开 FileFly", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show, &quit])?;
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().expect("app icon").clone())
                .tooltip("FileFly · 让文件飞")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭按钮 = 隐藏到托盘（保持索引/预览后台运行）；真正退出走托盘右键菜单"退出"
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::fs_list,
            commands::fs::fs_stat,
            commands::fs::fs_dir_sizes,
            commands::fs::fs_special_dirs,
            commands::fs::fs_operation,
            commands::fs::fs_drives,
            commands::fs::fs_home_stats,
            commands::fs::fs_category_files,
            commands::fs::fs_recent,
            commands::fs::fs_record_recent,
            commands::fs::fs_recent_clear,
            commands::fs::fs_thumbnail,
            commands::fs::fs_watch,
            commands::fs::fs_open,
            commands::fs::fs_open_terminal,
            commands::fs::fs_reveal,
            commands::fs::fs_trash_list,
            commands::fs::fs_trash_restore,
            commands::fs::fs_trash_delete,
            commands::fs::fs_trash_empty,
            commands::fs::fs_network_drives,
            commands::space::fs_space_scan,
            commands::space::fs_space_cancel,
            commands::space::fs_clean_targets,
            commands::space::fs_clean_targets_cancel,
            commands::space::fs_clean_execute,
            commands::fs::fs_batch_rename,
            commands::fs::fs_archive_list,
            commands::fs::fs_duplicates_scan,
            commands::tag::tag_list,
            commands::tag::tag_set,
            commands::tag::tag_add,
            commands::tag::tag_remove,
            commands::tag::tag_files_of,
            commands::tag::tag_archive_rule,
            commands::tag::tag_apply_archive,
            commands::tag::tag_def_create,
            commands::tag::tag_def_rename,
            commands::tag::tag_def_delete,
            commands::tag::tag_def_set_color,
            commands::search::search_query,
            commands::search::search_status,
            commands::preview::preview_code,
            commands::preview::preview_image,
            commands::preview::preview_exif,
            commands::preview::preview_media_meta,
            commands::preview::preview_pdf_page,
            commands::preview::preview_office,
            commands::preview::preview_cancel,
            commands::vault::vault_status,
            commands::vault::vault_create,
            commands::vault::vault_unlock,
            commands::vault::vault_recover,
            commands::vault::vault_change_password,
            commands::vault::vault_lock,
            commands::vault::vault_list,
            commands::vault::vault_add,
            commands::vault::vault_remove,
            commands::vault::vault_restore,
            commands::vault::vault_open,
            commands::vault::vault_verify_second,
            commands::vault::vault_set_second,
            commands::settings::settings_get,
            commands::settings::settings_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FileFly");
}
