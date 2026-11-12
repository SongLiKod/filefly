// preview 命令层（F-13~F-18）：预览可取消（cancellation token，§3 纪律 4）
use tauri::State;
type S<'a> = State<'a, crate::AppState>;

/// 解析类命令统一 30s 超时：防止任何解析卡住导致前端 invoke 永远挂起（加载态永不结束）
const PARSE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

async fn with_timeout<T>(
    task: tauri::async_runtime::JoinHandle<Result<T, String>>,
) -> Result<T, String> {
    match tokio::time::timeout(PARSE_TIMEOUT, task).await {
        Ok(r) => r.map_err(|e| format!("预览任务异常: {}", e))?,
        Err(_) => Err("解析超时（30 秒）：文件可能过大或被其他程序占用".into()),
    }
}

#[tauri::command]
pub async fn preview_code(path: String) -> Result<crate::preview::code::CodePreview, String> {
    let task = tauri::async_runtime::spawn_blocking(move || {
        let ext = std::path::Path::new(&path)
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        crate::preview::code::read_code(&path, &ext)
    });
    with_timeout(task).await
}

#[tauri::command]
pub async fn preview_image(path: String, max_edge: Option<u32>) -> Result<crate::preview::image::ImagePreview, String> {
    tauri::async_runtime::spawn_blocking(move || crate::preview::image::decode_image(&path, max_edge.unwrap_or(0)))
        .await
        .map_err(|e| e.to_string())?
}

/// EXIF 面板（F-14）
#[tauri::command]
pub async fn preview_exif(path: String) -> Result<crate::preview::image::ExifData, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(crate::preview::image::read_exif(&path)))
        .await
        .map_err(|e| e.to_string())?
}

/// 音频/视频元数据（封面、内嵌 LRC 歌词，F-16/F-17）
#[tauri::command]
pub async fn preview_media_meta(path: String) -> Result<crate::preview::media::MediaMeta, String> {
    tauri::async_runtime::spawn_blocking(move || crate::preview::media::probe(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// PDF 页渲染（P0；pdfium 就绪前前端回退内置渲染）
#[tauri::command]
pub async fn preview_pdf_page(path: String, page: u32, scale: Option<f32>) -> Result<crate::preview::office::PageRender, String> {
    tauri::async_runtime::spawn_blocking(move || crate::preview::office::render_pdf_page(&path, page, scale.unwrap_or(1.0)))
        .await
        .map_err(|e| e.to_string())?
}

/// Office 只读预览（P1）
#[tauri::command]
pub async fn preview_office(path: String) -> Result<crate::preview::office::OfficePreview, String> {
    let task = tauri::async_runtime::spawn_blocking(move || crate::preview::office::parse_office(&path));
    with_timeout(task).await
}

/// 取消当前预览会话（切换选中即取消，§3）
#[tauri::command]
pub async fn preview_cancel(session_id: String) -> Result<(), String> {
    crate::cancel_token(&session_id);
    Ok(())
}
