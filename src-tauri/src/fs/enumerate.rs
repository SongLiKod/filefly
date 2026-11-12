// 目录枚举：异步分批返回，300 条/批 event 推送，前端渐进渲染（技术文档 §3 纪律 2）
use serde::{Deserialize, Serialize};
use std::path::Path;
use walkdir::WalkDir;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EntryMeta {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime: i64,
    pub ext: Option<String>,
    pub hidden: bool,
    /// 云盘占位符状态（OneDrive files-on-demand）：none | online_only | partial | pinned
    pub placeholder_state: String,
    pub tags: Vec<String>,
}

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub enum SortField {
    Name,
    Size,
    Mtime,
    Ext,
}

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub enum SortOrder {
    Asc,
    Desc,
}

#[cfg(windows)]
fn is_hidden(p: &Path, name: &str) -> bool {
    name.starts_with('.')
        || p.file_name()
            .map(|f| {
                use std::os::windows::fs::MetadataExt;
                std::fs::metadata(p).map(|m| m.file_attributes() & 0x2 != 0).unwrap_or(false)
            })
            .unwrap_or(false)
}

#[cfg(not(windows))]
fn is_hidden(_p: &Path, name: &str) -> bool {
    name.starts_with('.')
}

/// 检测云盘占位符（技术文档 §13 风险 5：占位符降级，避免触发下载）
fn placeholder_state(p: &Path) -> String {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS (0x400000) / FILE_ATTRIBUTE_OFFLINE (0x1000)
        if let Ok(m) = std::fs::metadata(p) {
            let a = m.file_attributes();
            if a & 0x400000 != 0 {
                return "online_only".into();
            }
            if a & 0x1000 != 0 {
                return "partial".into();
            }
        }
    }
    let _ = p;
    "none".into()
}

pub fn list_dir(
    path: &str,
    show_hidden: bool,
    sort: SortField,
    order: SortOrder,
    tags_lookup: &dyn Fn(&str) -> Vec<String>,
) -> anyhow::Result<Vec<EntryMeta>> {
    let dir = Path::new(path);
    let mut out: Vec<EntryMeta> = Vec::new();
    let mut it = std::fs::read_dir(dir)?;
    while let Some(ent) = it.next() {
        let ent = match ent {
            Ok(e) => e,
            Err(_) => continue, // 权限/占用等错误跳过，绝不阻塞 UI
        };
        let name = ent.file_name().to_string_lossy().to_string();
        let hidden = is_hidden(&ent.path(), &name);
        if hidden && !show_hidden {
            continue;
        }
        let meta = match ent.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = meta.is_dir();
        let ext = Path::new(&name)
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase());
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let size = if is_dir { 0 } else { meta.len() };
        let p = ent.path().to_string_lossy().to_string();
        let tags = tags_lookup(&p);
        out.push(EntryMeta {
            name,
            path: p,
            is_dir,
            size,
            mtime,
            ext,
            hidden,
            placeholder_state: placeholder_state(&ent.path()),
            tags,
        });
    }
    // 序数排序：目录恒在文件前（Windows 资源管理器惯例）
    let ord = |a: &EntryMeta, b: &EntryMeta| -> std::cmp::Ordering {
        if a.is_dir != b.is_dir {
            return if a.is_dir { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater };
        }
        let c = match sort {
            SortField::Name => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            SortField::Size => a.size.cmp(&b.size),
            SortField::Mtime => a.mtime.cmp(&b.mtime),
            SortField::Ext => a.ext.cmp(&b.ext),
        };
        match order {
            SortOrder::Asc => c,
            SortOrder::Desc => c.reverse(),
        }
    };
    out.sort_by(ord);
    Ok(out)
}

/// 递归遍历（重复文件扫描用），限制深度防失控
pub fn walk_roots(roots: &[String], max_depth: usize) -> Vec<String> {
    let mut out = Vec::new();
    for r in roots {
        for e in WalkDir::new(r).max_depth(max_depth).into_iter().filter_map(|e| e.ok()) {
            if e.file_type().is_file() {
                out.push(e.path().to_string_lossy().to_string());
            }
        }
    }
    out
}
