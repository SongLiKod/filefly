// 图片解码 / EXIF / 缩放（技术文档 §6：jpeg-turbo/png/image-webp → RGBA，≤300ms）
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagePreview {
    pub width: u32,
    pub height: u32,
    /// 完整 PNG 文件的 base64（前端 data:image/png;base64 直出）
    pub data_base64: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExifData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub make: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exposure: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub f_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iso: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focal_length: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lens: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gps_lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gps_lng: Option<f64>,
}

/// 解码图片并编码为 PNG base64（预览兜底路径：asset 协议被 CSP/协议拦截时前端直出）
/// 历史 bug：曾返回原始 RGBA 字节却让前端按 PNG 渲染，导致兜底图永远加载失败 = 一片空白
pub fn decode_image(path: &str, max_edge: u32) -> Result<ImagePreview, String> {
    let img = image::open(Path::new(path)).map_err(|e| e.to_string())?;
    let mut rgba = img.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    if max_edge > 0 && w.max(h) > max_edge {
        let scale = max_edge as f32 / w.max(h) as f32;
        let nw = (w as f32 * scale) as u32;
        let nh = (h as f32 * scale) as u32;
        rgba = image::imageops::resize(&rgba, nw, nh, image::imageops::FilterType::Triangle);
    }
    // 真实 PNG 编码（带 IHDR/IDAT 完整结构，浏览器可直接渲染）
    let (ow, oh) = (rgba.width(), rgba.height());
    let mut png: Vec<u8> = Vec::new();
    image::DynamicImage::ImageRgba8(rgba)
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| format!("PNG 编码失败：{}", e))?;
    Ok(ImagePreview {
        width: ow,
        height: oh,
        data_base64: base64_encode::call(&png),
    })
}

/// EXIF 侧道解析（kamadak-exif，F-14）
pub fn read_exif(path: &str) -> ExifData {
    let mut out = ExifData::default();
    let file = match std::fs::File::open(Path::new(path)) {
        Ok(f) => f,
        Err(_) => return out,
    };
    let mut buf = std::io::BufReader::new(file);
    let exif = match exif::Reader::new().read_from_container(&mut buf) {
        Ok(e) => e,
        Err(_) => return out,
    };
    let get = |tag: exif::Tag| exif.get_field(tag, exif::In::PRIMARY).map(|f| f.display_value().to_string());
    out.make = get(exif::Tag::Make);
    out.model = get(exif::Tag::Model);
    out.date_time = get(exif::Tag::DateTime);
    out.exposure = get(exif::Tag::ExposureTime);
    out.f_number = get(exif::Tag::FNumber);
    out.iso = exif.get_field(exif::Tag::PhotographicSensitivity, exif::In::PRIMARY)
        .and_then(|f| f.value.get_uint(0));
    out.focal_length = get(exif::Tag::FocalLength);
    out.lens = get(exif::Tag::LensModel);
    out
}

pub mod base64_encode {
    // 轻量 base64（避免引依赖）
    const TBL: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    pub fn call(data: &[u8]) -> String {
        let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
        for chunk in data.chunks(3) {
            let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
            let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
            out.push(TBL[(n >> 18) as usize & 63] as char);
            out.push(TBL[(n >> 12) as usize & 63] as char);
            out.push(if chunk.len() > 1 { TBL[(n >> 6) as usize & 63] as char } else { '=' });
            out.push(if chunk.len() > 2 { TBL[n as usize & 63] as char } else { '=' });
        }
        out
    }
}

#[cfg(test)]
mod tests {
    /// 兜底解码必须输出真实 PNG（PNG magic 的 base64 前缀 iVBORw0KGgo）
    /// 历史 bug：曾输出原始 RGBA 字节导致前端兜底渲染永远失败 = 预览一片空白
    #[test]
    fn decode_image_returns_png() {
        let p = std::env::temp_dir().join(format!("ff-decode-test-{}.png", std::process::id()));
        image::DynamicImage::new_rgb8(64, 48).save(&p).unwrap();
        let out = super::decode_image(p.to_str().unwrap(), 0).unwrap();
        assert!(out.data_base64.starts_with("iVBORw0KGgo"), "输出必须是 PNG 编码");
        assert_eq!((out.width, out.height), (64, 48));
        // 限边缩放
        let out2 = super::decode_image(p.to_str().unwrap(), 32).unwrap();
        assert_eq!((out2.width, out2.height), (32, 24));
        let _ = std::fs::remove_file(&p);
    }
}

#[cfg(test)]
mod exif_json_tests {
    /// EXIF JSON 绝不能含 null（历史 bug：Option → JSON null，前端 null.toFixed 崩溃整窗白屏）
    #[test]
    fn exif_json_has_no_nulls() {
        let json = serde_json::to_string(&super::ExifData::default()).unwrap();
        assert!(!json.contains("null"), "EXIF 序列化不应出现 null，实际: {}", json);
        // 有值字段正常输出 camelCase
        let full = super::ExifData { make: Some("Canon".into()), iso: Some(200), ..Default::default() };
        let json2 = serde_json::to_string(&full).unwrap();
        assert!(json2.contains("\"make\":\"Canon\"") && json2.contains("\"iso\":200"), "实际: {}", json2);
    }
}
