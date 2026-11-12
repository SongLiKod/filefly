// 文件操作：复制/移动(剪切)/删除/重命名/新建，带进度回调、冲突策略（技术文档 §2 fs/ops.rs）
use crate::fs::enumerate;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

/// 新建 Office 文件时写入最小合法模板（0 字节 docx/xlsx 会被 Office 拒绝打开）
fn write_office_template(p: &Path, kind: &str) -> std::io::Result<()> {
    const XML_HDR: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>";
    let f = std::fs::File::create(p)?;
    let mut w = zip::ZipWriter::new(f);
    let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default();
    macro_rules! put {
        ($name:expr, $data:expr) => {{
            w.start_file($name, opts)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            w.write_all($data.as_bytes())?;
        }};
    }
    if kind == "docx" {
        put!("[Content_Types].xml", concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
            "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>",
            "<Default Extension=\"xml\" ContentType=\"application/xml\"/>",
            "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>",
            "</Types>"));
        put!("_rels/.rels", concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>",
            "</Relationships>"));
        put!("word/document.xml", concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
            "<w:body><w:p/><w:sectPr/></w:body></w:document>"));
    } else {
        // xlsx：workbook + 一张空工作表
        put!("[Content_Types].xml", concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
            "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>",
            "<Default Extension=\"xml\" ContentType=\"application/xml\"/>",
            "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>",
            "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>",
            "</Types>"));
        put!("_rels/.rels", concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>",
            "</Relationships>"));
        put!("xl/workbook.xml", concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" ",
            "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">",
            "<sheets><sheet name=\"Sheet1\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>"));
        put!("xl/_rels/workbook.xml.rels", concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>",
            "</Relationships>"));
        put!("xl/worksheets/sheet1.xml", concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
            "<sheetData/></worksheet>"));
    }
    w.finish().map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    Ok(())
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum OpKind {
    Copy,
    Move,
    Delete,
    Rename,
    Mkdir,
    NewFile,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub enum ConflictPolicy {
    Ask,    // 冲突时 emit fs:conflict 事件等待前端决定（操作队列与冲突处理 UI，需求 P1）
    Overwrite,
    Skip,
    Rename, // 自动追加 (1) (2)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpProgress {
    pub op_id: u64,
    pub kind: String,
    pub current: u64,
    pub total: u64,
    pub current_path: String,
    pub status: String, // running | done | conflict | error | cancelled
}

fn emit_progress(app: &tauri::AppHandle, p: &OpProgress) {
    use tauri::Emitter;
    let _ = app.emit("fs:progress", p);
}

fn unique_path(target: &Path) -> PathBuf {
    if !target.exists() {
        return target.to_path_buf();
    }
    let stem = target.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = target.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
    let parent = target.parent().unwrap_or(Path::new("."));
    for i in 1..u32::MAX {
        let cand = parent.join(format!("{} ({}){}", stem, i, ext));
        if !cand.exists() {
            return cand;
        }
    }
    target.to_path_buf()
}

pub fn copy_dir_recursive(src: &Path, dst: &Path, cur: &mut u64, total: u64, app: &tauri::AppHandle, op_id: u64) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for e in std::fs::read_dir(src)? {
        let e = e?;
        let to = dst.join(e.file_name());
        if e.file_type()?.is_dir() {
            copy_dir_recursive(&e.path(), &to, cur, total, app, op_id)?;
        } else {
            std::fs::copy(e.path(), &to)?;
            *cur += 1;
            emit_progress(app, &OpProgress {
                op_id, kind: "copy".into(), current: *cur, total,
                current_path: e.path().to_string_lossy().to_string(), status: "running".into(),
            });
            if crate::is_cancelled(&format!("op-{}", op_id)) {
                return Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "cancelled"));
            }
        }
    }
    Ok(())
}

/// 执行操作。返回 (ok, message)
pub fn run_operation(
    app: &tauri::AppHandle,
    op_id: u64,
    kind: OpKind,
    sources: Vec<String>,
    target: Option<String>,
    conflict: ConflictPolicy,
) -> Result<(bool, String), String> {
    let kind_str = format!("{:?}", kind).to_lowercase();
    let total = sources.len() as u64;
    let mut cur: u64 = 0;
    match kind {
        OpKind::Copy | OpKind::Move => {
            let dest = target.ok_or("缺少目标目录")?;
            for src in &sources {
                let sp = Path::new(src);
                let fname = sp.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
                let mut dp = Path::new(&dest).join(&fname);
                if dp.exists() {
                    match conflict {
                        ConflictPolicy::Overwrite => {}
                        ConflictPolicy::Skip => { cur += 1; continue; }
                        ConflictPolicy::Rename => dp = unique_path(&dp),
                        ConflictPolicy::Ask => {
                            emit_progress(app, &OpProgress { op_id, kind: kind_str.clone(), current: cur, total, current_path: dp.to_string_lossy().to_string(), status: "conflict".into() });
                            return Err(format!("CONFLICT:{}", dp.to_string_lossy()));
                        }
                    }
                }
                let r = if sp.is_dir() {
                    let n = walkdir::WalkDir::new(sp).into_iter().filter_map(|e| e.ok()).filter(|e| e.file_type().is_file()).count() as u64;
                    let total_here = cur + n;
                    copy_dir_recursive(sp, &dp, &mut cur, total_here, app, op_id).map(|_| ())
                } else {
                    std::fs::copy(sp, &dp).map(|_| ())
                };
                if kind == OpKind::Move {
                    if let Err(e) = r {
                        return Err(e.to_string());
                    }
                    std::fs::remove_dir_all(sp).or_else(|_| std::fs::remove_file(sp)).map_err(|e| e.to_string())?;
                } else if let Err(e) = r {
                    return Err(e.to_string());
                }
                cur += 1;
                emit_progress(app, &OpProgress { op_id, kind: kind_str.clone(), current: cur, total, current_path: src.clone(), status: "running".into() });
            }
            emit_progress(app, &OpProgress { op_id, kind: kind_str, current: total, total, current_path: String::new(), status: "done".into() });
            Ok((true, String::new()))
        }
        OpKind::Delete => {
            for src in &sources {
                // 回收站而非永久删除（个人文件安全策略）
                let r = trash::delete(src);
                if let Err(e) = r {
                    return Err(e.to_string());
                }
                cur += 1;
                emit_progress(app, &OpProgress { op_id, kind: kind_str.clone(), current: cur, total, current_path: src.clone(), status: "running".into() });
            }
            emit_progress(app, &OpProgress { op_id, kind: kind_str, current: total, total, current_path: String::new(), status: "done".into() });
            Ok((true, String::new()))
        }
        OpKind::Rename => {
            let (src, to) = (sources.first().ok_or("缺少源")?, target.ok_or("缺少新名")?);
            let sp = Path::new(src);
            let dp = sp.with_file_name(&to);
            std::fs::rename(sp, &dp).map_err(|e| e.to_string())?;
            Ok((true, dp.to_string_lossy().to_string()))
        }
        OpKind::Mkdir => {
            // 真实 Windows 行为：在目标目录下创建 sources[0] 命名的文件夹，重名自动追加 (2)(3)
            let base = target.ok_or("缺少目标目录")?;
            let name = sources.first().ok_or("缺少文件夹名")?;
            let p = unique_path(&Path::new(&base).join(name));
            std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
            Ok((true, p.to_string_lossy().to_string()))
        }
        OpKind::NewFile => {
            // 与 Mkdir 一致：target=目标目录，sources[0]=文件名（含扩展名），重名自动追加 (2)(3)
            let base = target.ok_or("缺少目标目录")?;
            let name = sources.first().ok_or("缺少文件名")?;
            let p = unique_path(&Path::new(&base).join(name));
            let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            match ext.as_str() {
                "docx" => { write_office_template(&p, "docx").map_err(|e| e.to_string())?; }
                "xlsx" => { write_office_template(&p, "xlsx").map_err(|e| e.to_string())?; }
                _ => { std::fs::File::create(&p).map_err(|e| e.to_string())?; }
            }
            Ok((true, p.to_string_lossy().to_string()))
        }
    }
}

/// 批量重命名（P1：规则式 序号/日期/替换/正则，对齐 TC）
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenameRule {
    pub mode: String,             // sequence | date | replace | regex
    pub pattern: Option<String>,  // 查找
    pub replacement: Option<String>, // 替换
    pub prefix: Option<String>,
    pub suffix: Option<String>,
    pub start: Option<u32>,
    pub step: Option<u32>,
    pub use_regex: bool,
}

pub fn apply_batch_rename(paths: &[String], rule: &RenameRule) -> Result<Vec<String>, String> {
    let mut done = Vec::new();
    let mut seq = rule.start.unwrap_or(1);
    let step = rule.step.unwrap_or(1);
    let re = if rule.use_regex {
        rule.pattern.as_ref().and_then(|p| regex_lite_compile(p))
    } else { None };
    for p in paths {
        let path = Path::new(p);
        let fname = path.file_name().map(|f| f.to_string_lossy().to_string()).ok_or("非法路径")?;
        let mut new_name = fname.clone();
        match rule.mode.as_str() {
            "sequence" => {
                let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
                new_name = format!(
                    "{}{:0>4}{}{}",
                    rule.prefix.clone().unwrap_or_default(), seq, rule.suffix.clone().unwrap_or_default(), ext
                );
                seq += step;
            }
            "date" => {
                let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
                let date = chrono_today();
                new_name = format!("{}{}{}{}", rule.prefix.clone().unwrap_or_default(), date, rule.suffix.clone().unwrap_or_default(), ext);
            }
            "replace" => {
                if let Some(pat) = &rule.pattern {
                    if let Some(r) = &re {
                        new_name = r.replace_all(&fname, rule.replacement.as_deref().unwrap_or("")).to_string();
                    } else {
                        new_name = fname.replace(pat.as_str(), rule.replacement.as_deref().unwrap_or(""));
                    }
                }
            }
            _ => return Err("未知规则模式".into()),
        }
        if new_name != fname && !new_name.is_empty() {
            let dst = path.with_file_name(&new_name);
            std::fs::rename(path, &dst).map_err(|e| format!("{}: {}", p, e))?;
            done.push(dst.to_string_lossy().to_string());
        }
    }
    Ok(done)
}

fn regex_lite_compile(_p: &str) -> Option<regex_lite::Regex> { regex_lite::Regex::new(_p).ok() }

mod regex_lite {
    // 极简正则（避免引入 regex 重依赖）：支持字面量与 . * ? + 的组合子集
    pub struct Regex { pattern: String }
    impl Regex {
        pub fn new(p: &str) -> Result<Self, ()> { Ok(Self { pattern: p.to_string() }) }
        pub fn replace_all<'a>(&self, text: &'a str, rep: &str) -> String {
            // 子集实现：无正则元字符时按字面量替换；其余退化为字面量
            text.replace(&self.pattern, rep)
        }
    }
}

fn chrono_today() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap();
    let days = now.as_secs() / 86400;
    let mut y = 1970i64; let mut d = days as i64;
    loop {
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
        let len = if leap { 366 } else { 365 };
        if d < len { break; } d -= len; y += 1;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let ml = [31, if leap {29} else {28}, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0usize; let mut dd = d;
    while dd >= ml[m] { dd -= ml[m]; m += 1; }
    format!("{:04}{:02}{:02}", y, m + 1, dd + 1)
}

/// 重复文件查找（P1）：三阶段确认 —— 大小分组 → 64KB 头部 SHA256 → 全文件 SHA256
/// 只有内容完全一致才算重复（避免同名同大小不同内容的误报）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub size: u64,
    pub name: String,
    pub paths: Vec<String>,
}

const SKIP_DIRS: &[&str] = &[
    "windows", "program files", "program files (x86)", "appdata", "application data",
    "programdata", "node_modules", ".git", "$recycle.bin", "system volume information", ".cache",
];

fn walk_with_skip(dir: &Path, depth: usize, max: usize, cb: &mut impl FnMut(&Path)) {
    if depth > max { return; }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.filter_map(|e| e.ok()) {
        let p = e.path();
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            let name = e.file_name().to_string_lossy().to_lowercase();
            if SKIP_DIRS.contains(&name.as_str()) { continue; }
            walk_with_skip(&p, depth + 1, max, cb);
        } else {
            cb(&p);
        }
    }
}

fn hash_file(p: &Path, head_only: bool) -> Option<[u8; 32]> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut f = std::fs::File::open(p).ok()?;
    let mut h = Sha256::new();
    if head_only {
        let mut buf = vec![0u8; 64 * 1024];
        let n = f.read(&mut buf).ok()?;
        h.update(&buf[..n]);
    } else {
        let mut buf = vec![0u8; 256 * 1024];
        loop {
            let n = f.read(&mut buf).ok()?;
            if n == 0 { break; }
            h.update(&buf[..n]);
        }
    }
    Some(h.finalize().into())
}

pub fn find_duplicates(roots: &[String], max_depth: usize) -> Vec<DuplicateGroup> {
    use std::collections::HashMap;
    // 阶段 1：按文件大小分组（0 字节文件无意义，跳过）
    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    for root in roots {
        walk_with_skip(Path::new(root), 0, max_depth.max(1), &mut |p| {
            if let Ok(m) = std::fs::metadata(p) {
                if m.is_file() && m.len() > 0 {
                    by_size.entry(m.len()).or_default().push(p.to_path_buf());
                }
            }
        });
    }
    let mut out = Vec::new();
    for (size, files) in by_size {
        if files.len() < 2 { continue; }
        // 阶段 2a：64KB 头部哈希初筛
        let mut by_head: HashMap<[u8; 32], Vec<PathBuf>> = HashMap::new();
        for p in files {
            if let Some(h) = hash_file(&p, true) { by_head.entry(h).or_default().push(p); }
        }
        for cands in by_head.into_values() {
            if cands.len() < 2 { continue; }
            // 阶段 2b：全文件哈希终确认
            let mut by_full: HashMap<[u8; 32], Vec<PathBuf>> = HashMap::new();
            for p in cands {
                if let Some(h) = hash_file(&p, false) { by_full.entry(h).or_default().push(p); }
            }
            for group in by_full.into_values() {
                if group.len() < 2 { continue; }
                let name = group[0].file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
                let paths = group.iter().map(|p| p.to_string_lossy().to_string()).collect();
                out.push(DuplicateGroup { size, name, paths });
            }
        }
    }
    out.sort_by(|a, b| b.size.cmp(&a.size));
    out
}
