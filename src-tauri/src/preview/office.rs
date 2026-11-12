// Office/PDF 预览（技术文档 §6 office.rs）：PDF P0（浏览器内置渲染）；docx/xlsx/pptx P1 只读
use serde::Serialize;
use std::io::Read;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRender {
    pub page_index: u32,
    pub width: u32,
    pub height: u32,
    pub png_base64: String,
}

/// PDF 页面渲染位图（P0；pdfium-render 在 M2 构建管线内静态链接，前端为浏览器内置渲染回退）
pub fn render_pdf_page(path: &str, page: u32, scale: f32) -> Result<PageRender, String> {
    let _ = (path, page, scale);
    Err("PDF_PDFIUM_NOT_READY: 前端将回退内置 PDF 渲染".into())
}

/// docx/doc 段落：文本 + 段内嵌图片（已提取到临时缓存的绝对路径，前端经 asset 协议显示）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocPara {
    pub text: String,
    pub images: Vec<String>,
}

/// docx/xlsx/pptx 只读结构化解析（P1，zip crate 真实 deflate 解码）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficePreview {
    pub kind: String, // docx | doc | xlsx | pptx
    pub paragraphs: Vec<String>,
    /// docx/doc 专用：按顺序的段落（含段内图片）；paragraphs 仍保留纯文本以兼容
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub doc_paragraphs: Vec<DocPara>,
    pub sheets: Vec<(String, Vec<Vec<String>>)>,
    pub slide_count: usize,
    pub slides: Vec<SlidePreview>,
}

/// pptx 单页解析结果：标题（占位符 type=title/ctrTitle）+ 正文段落（按页内出现顺序）
/// images：该页内嵌图片已提取到临时缓存的绝对路径（前端经 asset 协议显示）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlidePreview {
    pub index: usize,
    pub title: String,
    pub texts: Vec<String>,
    pub images: Vec<String>,
}

/// 读取 zip 内成员字节
fn read_member<R: Read + std::io::Seek>(arch: &mut zip::ZipArchive<R>, name: &str) -> Result<Vec<u8>, String> {
    let mut f = arch.by_name(name).map_err(|_| format!("member not found: {}", name))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

/// WebView 可直接渲染的内嵌图片扩展名（emf/wmf 矢量格式跳过）
const IMG_EXTS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"];

/// OLE2 复合文档（旧版 Office .doc/.ppt/.xls）魔数
const OLE_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

/// 图片提取缓存目录：<root>/<tag>-<源路径+大小哈希>（源文件变更自动失效）
fn cache_dir_for(root: &Path, tag: &str, source_key: &str) -> std::path::PathBuf {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hash::hash(&source_key, &mut hasher);
    root.join(format!("{}-{}", tag, std::hash::Hasher::finish(&hasher)))
}

pub fn parse_office(path: &str) -> Result<OfficePreview, String> {
    let p = Path::new(path);
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    // 容器嗅探（前 8 字节）：.doc 可能是 OOXML zip 改名、OLE2 复合文档或 RTF，
    // 不嗅探就会把二进制当文本读出乱码
    let mut head = Vec::new();
    std::fs::File::open(p)
        .map_err(|e| e.to_string())?
        .take(8)
        .read_to_end(&mut head)
        .map_err(|e| e.to_string())?;
    let is_zip = head.starts_with(b"PK");
    let is_ole = head.starts_with(&OLE_MAGIC[..]);
    if ext == "doc" {
        if is_ole {
            return parse_doc_ole(path);
        }
        if is_zip {
            // zip 容器 = 实为 docx（改名/兼容保存），落入下方 docx 分支
        } else if head.starts_with(b"{\\rtf") {
            return Err("RTF 文档暂不支持内置预览，请用系统默认程序打开".into());
        } else {
            return Err("无法识别的 .doc 文档容器，请用系统默认程序打开".into());
        }
    }
    let file = std::fs::File::open(p).map_err(|e| e.to_string())?;
    let mut arch = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    match ext.as_str() {
        "docx" | "doc" => {
            // docx = zip；word/document.xml → <w:p> 段落 + <w:t> 文本 + 段内嵌图片
            let raw = read_member(&mut arch, "word/document.xml")?;
            let xml = String::from_utf8_lossy(&raw).to_string();
            // 关系映射：word/_rels/document.xml.rels（rId → media 目标）
            let rels: std::collections::HashMap<String, String> =
                match read_member(&mut arch, "word/_rels/document.xml.rels") {
                    Ok(r) => {
                        let s = String::from_utf8_lossy(&r).to_string();
                        extract_all(&s, "<Relationship ", "/>")
                            .into_iter()
                            .filter_map(|rel| {
                                let id = extract_all(&rel, "Id=\"", "\"").into_iter().next()?;
                                let target = extract_all(&rel, "Target=\"", "\"").into_iter().next()?;
                                Some((id, target))
                            })
                            .collect()
                    }
                    Err(_) => Default::default(),
                };
            let cache_root = std::env::temp_dir().join("filefly-pptx");
            let source_key = format!(
                "{}|{}",
                path,
                std::fs::metadata(p).map(|m| m.len().to_string()).unwrap_or_default()
            );
            let dir = cache_dir_for(&cache_root, "docx", &source_key);
            let mut doc_paras: Vec<DocPara> = Vec::new();
            for seg in split_tags(&xml, "<w:p ", "</w:p>").chain(split_tags(&xml, "<w:p>", "</w:p>")) {
                let text: String = inner_all(&seg, "<w:t", "</w:t>")
                    .into_iter()
                    .map(|s| strip_tags(&s))
                    .collect::<Vec<_>>()
                    .join("");
                // 段内图片引用：drawingML <a:blip r:embed> + VML <v:imagedata r:id>（兼容模式文档常见）
                let mut rids: Vec<String> = extract_all(&seg, "r:embed=\"", "\"");
                for attr in split_tags(&seg, "<v:imagedata", ">") {
                    rids.extend(extract_all(attr, "r:id=\"", "\""));
                }
                let mut images = Vec::new();
                let mut seen = std::collections::HashSet::new();
                for rid in rids {
                    if !seen.insert(rid.clone()) { continue; }
                    let target = match rels.get(&rid) { Some(t) => t.clone(), None => continue };
                    let lower = target.to_lowercase();
                    if !IMG_EXTS.iter().any(|e| lower.ends_with(&format!(".{}", e))) { continue; }
                    let member = if let Some(stripped) = target.strip_prefix('/') {
                        stripped.to_string() // 绝对引用 "/word/media/x.png"
                    } else {
                        resolve_zip_member("word", &target) // 相对引用 "media/x.png"
                    };
                    let bytes = match read_member(&mut arch, &member) { Ok(b) => b, Err(_) => continue };
                    let fname = member.rsplit('/').next().unwrap_or("img.bin").to_string();
                    let dest = dir.join(&fname);
                    if !dest.exists() {
                        if std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&dest, &bytes)).is_err() {
                            continue;
                        }
                    }
                    images.push(dest.to_string_lossy().to_string());
                }
                if !text.trim().is_empty() || !images.is_empty() {
                    doc_paras.push(DocPara { text, images });
                }
            }
            let paragraphs = doc_paras.iter().map(|x| x.text.clone()).filter(|t| !t.trim().is_empty()).collect();
            Ok(OfficePreview { kind: "docx".into(), paragraphs, doc_paragraphs: doc_paras, sheets: vec![], slide_count: 0, slides: vec![] })
        }
        "xlsx" => {
            // 共享字符串表
            let strings: Vec<String> = match read_member(&mut arch, "xl/sharedStrings.xml") {
                Ok(raw) => {
                    let xml = String::from_utf8_lossy(&raw).to_string();
                    extract_all(&xml, "<si>", "</si>").into_iter().map(|si| {
                        inner_all(&si, "<t", "</t>").into_iter().map(|t| strip_tags(&t)).collect::<Vec<_>>().join("")
                    }).collect()
                }
                Err(_) => vec![],
            };
            // 工作表名（workbook.xml 顺序与 sheetN.xml 编号对应，按编号排序）
            let sheet_names: Vec<String> = match read_member(&mut arch, "xl/workbook.xml") {
                Ok(raw) => {
                    let xml = String::from_utf8_lossy(&raw).to_string();
                    extract_all(&xml, "<sheet ", "/>").into_iter().map(|s| {
                        extract_all(&s, "name=\"", "\"").first().cloned().unwrap_or_else(|| "Sheet".into())
                    }).collect()
                }
                Err(_) => vec![],
            };
            // 收集 worksheets 成员并按 sheetN 编号排序
            let mut members: Vec<(usize, String)> = (0..arch.len())
                .filter_map(|i| arch.by_index(i).ok().map(|f| (i, f.name().to_string())))
                .filter(|(_, n)| n.starts_with("xl/worksheets/sheet") && n.ends_with(".xml"))
                .collect();
            members.sort_by_key(|(_, n)| {
                n.rsplit('/').next().unwrap_or("")
                    .trim_start_matches("sheet").trim_end_matches(".xml").parse::<u32>().unwrap_or(0)
            });
            let mut sheets = Vec::new();
            for (idx, (_, name)) in members.iter().enumerate() {
                let raw = read_member(&mut arch, name)?;
                let xml = String::from_utf8_lossy(&raw).to_string();
                let mut grid: Vec<Vec<String>> = Vec::new();
                for row_seg in split_tags(&xml, "<row ", "</row>").chain(split_tags(&xml, "<row>", "</row>")) {
                    let mut row: Vec<(u32, String)> = Vec::new();
                    for cell_seg in split_tags(&row_seg, "<c ", "</c>") {
                        // 列号（r="C5" → 2）
                        let r_attr = extract_all(&cell_seg, "r=\"", "\"").first().cloned().unwrap_or_default();
                        let col = r_attr.chars().take_while(|c| c.is_ascii_alphabetic())
                            .fold(0u32, |acc, c| acc * 26 + (c.to_ascii_uppercase() as u32 - 'A' as u32 + 1))
                            .saturating_sub(1);
                        let is_shared = cell_seg.contains("t=\"s\"");
                        let val = inner_all(&cell_seg, "<v", "</v>").first().cloned().unwrap_or_default();
                        let text = if is_shared {
                            strings.get(val.trim().parse::<usize>().unwrap_or(usize::MAX)).cloned().unwrap_or_default()
                        } else {
                            strip_tags(&val)
                        };
                        row.push((col, text));
                    }
                    if row.is_empty() { continue; }
                    let width = row.iter().map(|(c, _)| *c).max().unwrap_or(0) as usize + 1;
                    let mut line = vec![String::new(); width];
                    for (c, t) in row { if (c as usize) < width { line[c as usize] = t; } }
                    grid.push(line);
                }
                let width = grid.iter().map(|r| r.len()).max().unwrap_or(0);
                for r in grid.iter_mut() { r.resize(width, String::new()); }
                let sheet_name = sheet_names.get(idx).cloned().unwrap_or_else(|| format!("Sheet{}", idx + 1));
                sheets.push((sheet_name, grid));
            }
            if sheets.is_empty() { sheets.push(("Sheet1".into(), vec![])); }
            Ok(OfficePreview { kind: "xlsx".into(), paragraphs: vec![], doc_paragraphs: vec![], sheets, slide_count: 0, slides: vec![] })
        }
        "pptx" => {
            // 每页幻灯片：ppt/slides/slideN.xml（按编号排序，避免 slide10 排在 slide2 前）
            let mut members: Vec<(u32, String)> = (0..arch.len())
                .filter_map(|i| arch.by_index(i).ok().map(|f| (i, f.name().to_string())))
                .filter(|(_, n)| n.starts_with("ppt/slides/slide") && n.ends_with(".xml"))
                .map(|(_, n)| {
                    let num: u32 = n.rsplit('/').next().unwrap_or("")
                        .trim_start_matches("slide").trim_end_matches(".xml").parse().unwrap_or(0);
                    (num, n)
                })
                .collect();
            members.sort_by_key(|(n, _)| *n);
            // 内嵌图片提取缓存：<TEMP>/filefly-pptx/<源路径+大小哈希>/（文件变更自动换目录）
            let cache_root = std::env::temp_dir().join("filefly-pptx");
            let source_key = format!(
                "{}|{}",
                path,
                std::fs::metadata(p).map(|m| m.len().to_string()).unwrap_or_default()
            );
            let mut slides = Vec::new();
            for (num, name) in members {
                let raw = match read_member(&mut arch, &name) { Ok(r) => r, Err(_) => continue };
                let xml = String::from_utf8_lossy(&raw).to_string();
                let mut title = String::new();
                let mut texts: Vec<String> = Vec::new();
                // 形状 <p:sp>：标题占位符（type="title"/"ctrTitle"）文本作页标题，其余为正文段落
                for shape in split_tags(&xml, "<p:sp>", "</p:sp>").chain(split_tags(&xml, "<p:sp ", "</p:sp>")) {
                    let is_title = shape.contains("type=\"title\"") || shape.contains("type=\"ctrTitle\"");
                    for para in split_tags(&shape, "<a:p>", "</a:p>").chain(split_tags(&shape, "<a:p ", "</a:p>")) {
                let text: String = inner_all(&para, "<a:t", "</a:t>")
                    .into_iter()
                    .map(|s| strip_tags(&s))
                    .collect::<Vec<_>>()
                    .join("");
                        let t = text.trim().to_string();
                        if t.is_empty() { continue; }
                        if is_title && title.is_empty() { title = t; } else { texts.push(t); }
                    }
                }
                // 无标题占位符（AI 工具生成的幻灯片常见）：把首条正文提升为页标题
                let (title, texts) = if title.is_empty() && !texts.is_empty() {
                    let first = texts.remove(0);
                    (first, texts)
                } else {
                    (title, texts)
                };
                let images = extract_slide_images(&mut arch, &xml, num, &cache_root, &source_key);
                slides.push(SlidePreview { index: num as usize, title, texts, images });
            }
            let slide_count = slides.len();
            Ok(OfficePreview { kind: "pptx".into(), paragraphs: vec![], doc_paragraphs: vec![], sheets: vec![], slide_count, slides })
        }
        _ => Err(format!("不支持的 Office 格式: {}", ext)),
    }
}

fn split_tags<'a>(s: &'a str, open: &'a str, close: &'a str) -> impl Iterator<Item = &'a str> + 'a {
    s.split(open).skip(1).filter_map(move |seg| seg.split_once(close).map(|(a, _)| a))
}

/// 提取单页幻灯片的内嵌图片：slide XML 里 r:embed="rIdX" → slideN.xml.rels 映射 →
/// ppt/media/* 成员解压到缓存目录。返回可显示图片的绝对路径（按引用顺序，去重）。
/// emf/wmf 等 WebView 无法渲染的矢量格式跳过；每页最多 12 张。
fn extract_slide_images<R: Read + std::io::Seek>(
    arch: &mut zip::ZipArchive<R>,
    slide_xml: &str,
    slide_num: u32,
    cache_root: &Path,
    source_key: &str,
) -> Vec<String> {
    use std::collections::{HashMap, HashSet};
    let rids: Vec<String> = extract_all(slide_xml, "r:embed=\"", "\"");
    if rids.is_empty() { return vec![]; }
    let rels_name = format!("ppt/slides/_rels/slide{}.xml.rels", slide_num);
    let rels = match read_member(arch, &rels_name) {
        Ok(r) => String::from_utf8_lossy(&r).to_string(),
        Err(_) => return vec![],
    };
    let mut map: HashMap<String, String> = HashMap::new();
    for rel in split_tags(&rels, "<Relationship ", "/>") {
        let id = extract_all(rel, "Id=\"", "\"").first().cloned().unwrap_or_default();
        let target = extract_all(rel, "Target=\"", "\"").first().cloned().unwrap_or_default();
        if !id.is_empty() && !target.is_empty() { map.insert(id, target); }
    }
    // 缓存目录按源文件（路径+大小）哈希隔离，源文件变更自动失效
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hash::hash(&source_key, &mut hasher);
    let dir = cache_root.join(format!("{}", std::hash::Hasher::finish(&hasher)));
    const IMG_EXTS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"];
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for rid in rids {
        if !seen.insert(rid.clone()) { continue; }
        let target = match map.get(&rid) { Some(t) => t.clone(), None => continue };
        let lower = target.to_lowercase();
        if !IMG_EXTS.iter().any(|e| lower.ends_with(&format!(".{}", e))) { continue; }
        let member = resolve_zip_member("ppt/slides", &target);
        let bytes = match read_member(arch, &member) { Ok(b) => b, Err(_) => continue };
        let fname = member.rsplit('/').next().unwrap_or("img.bin").to_string();
        let dest = dir.join(&fname);
        if !dest.exists() {
            if std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&dest, &bytes)).is_err() {
                continue;
            }
        }
        out.push(dest.to_string_lossy().to_string());
        if out.len() >= 12 { break; }
    }
    out
}

/// zip 内相对路径解析（base 为成员所在目录，如 "ppt/slides"；Target 形如 "../media/image1.png"）
fn resolve_zip_member(base: &str, target: &str) -> String {
    let mut stack: Vec<&str> = base.split('/').collect();
    for seg in target.split('/') {
        match seg {
            "." | "" => {}
            ".." => { stack.pop(); }
            s => stack.push(s),
        }
    }
    stack.join("/")
}

fn extract_all(s: &str, open: &str, close: &str) -> Vec<String> {
    split_tags(s, open, close).map(|x| x.to_string()).collect()
}

/// 提取标签内文本内容（open 形如 "<w:t"，兼容带属性标签）：
/// split 后的段首会带 "属性>" 或 ">"，先跳过第一个 '>' 再取到 close 之前，
/// 否则文本会带前导 '>'（此前 docx/xlsx/pptx 文本均有此污染）
fn inner_all(s: &str, open: &str, close: &str) -> Vec<String> {
    s.split(open).skip(1).filter_map(|seg| {
        let after = seg.split_once('>')?.1;
        after.split_once(close).map(|(a, _)| a.to_string())
    }).collect()
}

fn strip_tags(s: &str) -> String {
    let mut out = String::new();
    let mut inside = false;
    for c in s.chars() {
        match c {
            '<' => inside = true,
            '>' => inside = false,
            c if !inside => out.push(c),
            _ => {}
        }
    }
    out
}

// —— 旧版 Word .doc（OLE2 复合文档）正文提取 ——

/// 打开 .doc：读 WordDocument 流 + FIB 定位 CLX → table 流分片表 → 拼出正文
pub fn parse_doc_ole(path: &str) -> Result<OfficePreview, String> {
    let mut comp = cfb::open(path).map_err(|e| format!("OLE 文档打开失败: {}", e))?;
    let word: Vec<u8> = {
        let mut s = comp.open_stream("/WordDocument").map_err(|_| "缺少 WordDocument 流".to_string())?;
        let mut b = Vec::new();
        s.read_to_end(&mut b).map_err(|e| e.to_string())?;
        b
    };
    // FibBase flags（偏移 0x0A）bit9 = fWhichTblStm：决定用 1Table 还是 0Table
    let flags = if word.len() >= 0x0C {
        u16::from_le_bytes([word[0x0A], word[0x0B]])
    } else {
        return Err("WordDocument 流过短（非有效 .doc）".into());
    };
    let table_name = if flags & 0x0200 != 0 { "/1Table" } else { "/0Table" };
    let table: Vec<u8> = match comp.open_stream(table_name) {
        Ok(mut s) => {
            let mut b = Vec::new();
            s.read_to_end(&mut b).map_err(|e| e.to_string())?;
            b
        }
        Err(_) => match comp.open_stream(if flags & 0x0200 != 0 { "/0Table" } else { "/1Table" }) {
            Ok(mut s) => {
                let mut b = Vec::new();
                s.read_to_end(&mut b).map_err(|e| e.to_string())?;
                b
            }
            Err(_) => return Err("缺少 table 流（非有效 .doc）".into()),
        },
    };
    let text = doc_text_from_streams(&word, &table)?;
    let paragraphs = doc_text_to_paragraphs(&text);
    let doc_paragraphs = paragraphs.iter().map(|t| DocPara { text: t.clone(), images: vec![] }).collect();
    Ok(OfficePreview { kind: "doc".into(), paragraphs, doc_paragraphs, sheets: vec![], slide_count: 0, slides: vec![] })
}

/// 从 WordDocument 流 + table 流（CLX/PlcPcd 分片表）还原文档字符流。
/// 分片可各自选择 8-bit 压缩（fc bit30，偏移需 /2）或 UTF-16LE 直存。
fn doc_text_from_streams(word: &[u8], table: &[u8]) -> Result<String, String> {
    let u16at = |b: &[u8], o: usize| -> Option<u16> {
        if o + 2 <= b.len() { Some(u16::from_le_bytes([b[o], b[o + 1]])) } else { None }
    };
    let u32at = |b: &[u8], o: usize| -> Option<u32> {
        if o + 4 <= b.len() { Some(u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])) } else { None }
    };
    if u16at(word, 0) != Some(0xA5EC) {
        return Err("WordDocument 流缺少 FIB 魔数（非 Word 97+ 文档）".into());
    }
    let n_fib = u16at(word, 2).unwrap_or(0);
    if n_fib < 0x00C1 {
        return Err(format!("不支持 Word 6/95 及更早版本 (nFib=0x{:04X})", n_fib));
    }
    let fc_clx = u32at(word, 0x01A2).ok_or("FIB 过短（缺 fcClx）")?;
    let lcb_clx = u32at(word, 0x01A6).ok_or("FIB 过短（缺 lcbClx）")?;
    if lcb_clx == 0 || fc_clx as usize + lcb_clx as usize > table.len() {
        return Err("CLX 缺失或越界".into());
    }
    let clx = &table[fc_clx as usize..fc_clx as usize + lcb_clx as usize];
    // CLX = 若干 Prc(clxt=0x01) + Pcdt(clxt=0x02)，跳过 Prc 找到 PlcPcd
    let mut pos = 0usize;
    let plc: &[u8] = loop {
        if pos >= clx.len() { return Err("CLX 中未找到 Pcdt 分片表".into()); }
        match clx[pos] {
            0x01 => {
                if pos + 3 > clx.len() { return Err("CLX Prc 段截断".into()); }
                let cb = i16::from_le_bytes([clx[pos + 1], clx[pos + 2]]);
                pos += 3 + (cb.max(0) as usize);
            }
            0x02 => {
                if pos + 5 > clx.len() { return Err("CLX Pcdt 段截断".into()); }
                let lcb = u32::from_le_bytes([clx[pos + 1], clx[pos + 2], clx[pos + 3], clx[pos + 4]]) as usize;
                let start = pos + 5;
                if start + lcb > clx.len() { return Err("PlcPcd 越界".into()); }
                break &clx[start..start + lcb];
            }
            _ => return Err(format!("CLX 结构异常 (clxt=0x{:02X})", clx[pos])),
        }
    };
    // PlcPcd = (n+1)×CP + n×PCD(8B) → 总长 = 12n+4
    if plc.len() < 4 { return Err("PlcPcd 过短".into()); }
    let n = (plc.len() - 4) / 12;
    if n == 0 { return Err("分片表为空".into()); }
    let mut text = String::new();
    for i in 0..n {
        let cp0 = u32at(plc, i * 4).ok_or("CP 越界")?;
        let cp1 = u32at(plc, (i + 1) * 4).ok_or("CP 越界")?;
        let len = cp1.saturating_sub(cp0) as usize;
        if len == 0 { continue; }
        let pcd = 4 * (n + 1) + i * 8;
        let fc = u32at(plc, pcd + 2).ok_or("PCD 越界")?;
        if fc & 0x4000_0000 != 0 {
            // 8-bit 压缩分片：fc 存的是偏移×2，每字符 1 字节（ANSI；中文文档正文通常不走此分支）
            let off = ((fc & 0x3FFF_FFFF) / 2) as usize;
            for k in 0..len {
                let b = *word.get(off + k).ok_or("压缩分片越界")?;
                text.push(b as char);
            }
        } else {
            // UTF-16LE 直存分片
            let off = (fc & 0x3FFF_FFFF) as usize;
            for k in 0..len {
                let o = off + k * 2;
                let lo = *word.get(o).ok_or("文本分片越界")?;
                let hi = *word.get(o + 1).unwrap_or(&0);
                text.push(char::from_u32(u16::from_le_bytes([lo, hi]) as u32).unwrap_or('\u{FFFD}'));
            }
        }
    }
    Ok(text)
}

/// Word 字符流 → 段落：\r 为段落结束，\x07 单元格/行标记转制表，其余控制符剔除
fn doc_text_to_paragraphs(text: &str) -> Vec<String> {
    text.split('\r')
        .map(|seg| {
            seg.replace('\u{0007}', "\t")
                .replace('\u{000B}', "\n")
                .chars()
                .filter(|c| *c == '\n' || *c == '\t' || !c.is_control())
                .collect::<String>()
                .trim()
                .to_string()
        })
        .filter(|s| !s.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u16le(v: u16) -> [u8; 2] { v.to_le_bytes() }
    fn u32le(v: u32) -> [u8; 4] { v.to_le_bytes() }

    /// 合成一份最小 .doc：WordDocument 流（FIB + 正文数据）与 table 流（CLX 分片表）。
    /// 分片 0：压缩 8-bit "Hi\r"；分片 1：UTF-16LE "你好"
    fn build_doc_streams() -> (Vec<u8>, Vec<u8>) {
        let off0 = 0x1B0usize; // "Hi\r" (ANSI)
        let off1 = 0x1C0usize; // "你好" (UTF-16LE)
        let mut word = vec![0u8; 0x200];
        word[0x00..0x02].copy_from_slice(&u16le(0xA5EC)); // wIdent
        word[0x02..0x04].copy_from_slice(&u16le(0x00C1)); // nFib (Word 97)
        word[0x0A..0x0C].copy_from_slice(&u16le(0x0000)); // flags: fWhichTblStm=0 → 0Table
        word[off0..off0 + 3].copy_from_slice(b"Hi\r");
        let utf16: Vec<u8> = "你好".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        word[off1..off1 + utf16.len()].copy_from_slice(&utf16);
        // CLX: Prc(0x01, cb=2, 2 字节垃圾) + Pcdt(0x02, lcb, PlcPcd)
        let mut plc = Vec::new();
        plc.extend_from_slice(&u32le(0));
        plc.extend_from_slice(&u32le(3)); // "Hi\r" = 3 字符
        plc.extend_from_slice(&u32le(5)); // "你好" = 2 字符 → CP 5
        // PCD 0：压缩，偏移 off0 → fc = 0x4000_0000 | off0*2
        let mut pcd0 = [0u8; 8];
        pcd0[2..6].copy_from_slice(&u32le(0x4000_0000 | (off0 as u32) * 2));
        // PCD 1：UTF-16，偏移 off1
        let mut pcd1 = [0u8; 8];
        pcd1[2..6].copy_from_slice(&u32le(off1 as u32));
        let mut plcpcd = plc;
        plcpcd.extend_from_slice(&pcd0);
        plcpcd.extend_from_slice(&pcd1);
        let mut clx = vec![0x01u8, 0x02, 0x00, 0xAA, 0xBB]; // Prc 头 + 2 字节数据
        clx.push(0x02);
        clx.extend_from_slice(&u32le(plcpcd.len() as u32));
        clx.extend_from_slice(&plcpcd);
        word[0x01A2..0x01A6].copy_from_slice(&u32le(0)); // fcClx（合成 table 流即 CLX 本身，从 0 开始）
        word[0x01A6..0x01AA].copy_from_slice(&u32le(clx.len() as u32)); // lcbClx
        (word, clx)
    }

    #[test]
    fn doc_text_extraction_pieces() {
        let (word, table) = build_doc_streams();
        let text = doc_text_from_streams(&word, &table).expect("提取失败");
        let paras = doc_text_to_paragraphs(&text);
        assert_eq!(paras, vec!["Hi".to_string(), "你好".to_string()]);
    }

    #[test]
    fn doc_text_rejects_bad_magic() {
        let (mut word, table) = build_doc_streams();
        word[0] = 0x00; word[1] = 0x11; // 破坏 wIdent
        assert!(doc_text_from_streams(&word, &table).is_err());
    }

    #[test]
    fn doc_paragraphs_filter_control_and_empty() {
        let raw = "A\u{0001}B\r\u{0007}x\r\rC\u{000B}D\r";
        assert_eq!(doc_text_to_paragraphs(raw), vec!["AB".to_string(), "x".to_string(), "C\nD".to_string()]);
    }

    /// 真实 .doc 冒烟验证（cargo test --lib -- --ignored --nocapture；文件缺失则跳过）
    #[test]
    #[ignore]
    fn doc_real_file_smoke() {
        let candidates = [
            r"C:\Users\lee1\Desktop\副本黔路智养功能介绍.doc",
        ];
        let p = match candidates.iter().find(|c| Path::new(c).exists()) {
            Some(p) => *p,
            None => return,
        };
        let r = parse_doc_ole(p).expect("真实 .doc 解析失败");
        println!("kind={} 段落数={}", r.kind, r.paragraphs.len());
        for seg in r.paragraphs.iter().take(8) {
            println!("  | {}", seg);
        }
        assert!(!r.paragraphs.is_empty(), "真实 .doc 未提取到任何段落");
    }

    /// 真实 docx 图片提取冒烟验证（cargo test --lib -- --ignored --nocapture）
    #[test]
    #[ignore]
    fn docx_real_image_smoke() {
        let candidates = [
            r"C:\Users\lee1\Desktop\20260909记录.docx",
            r"C:\Users\lee1\Desktop\20260909记录 - 副本.docx",
        ];
        let p = match candidates.iter().find(|c| Path::new(c).exists()) {
            Some(p) => *p,
            None => return,
        };
        let r = parse_office(p).expect("真实 docx 解析失败");
        let imgs: usize = r.doc_paragraphs.iter().map(|x| x.images.len()).sum();
        println!("kind={} 段落数={} 图片数={}", r.kind, r.doc_paragraphs.len(), imgs);
        for para in r.doc_paragraphs.iter().filter(|x| !x.images.is_empty()).take(3) {
            println!("  图片段: text={} imgs={:?}", para.text.chars().take(20).collect::<String>(), para.images);
        }
        assert!(imgs > 0, "真实 docx 未提取到任何图片");
        for para in r.doc_paragraphs.iter() {
            for img in &para.images {
                assert!(Path::new(img).exists(), "缓存图片不存在: {}", img);
            }
        }
    }

    /// 真实 pptx 解析冒烟验证（cargo test --lib -- --ignored --nocapture --test-threads=1）
    #[test]
    #[ignore]
    fn pptx_real_file_smoke() {
        let candidates = [
            r"C:\Users\lee1\Desktop\培训\企业IM与OA使用培训 - 副本 (2).pptx",
            r"C:\Users\lee1\Desktop\培训\企业IM与OA使用培训 - 副本.pptx",
        ];
        let p = match candidates.iter().find(|c| Path::new(c).exists()) {
            Some(p) => *p,
            None => return,
        };
        let t0 = std::time::Instant::now();
        let r = parse_office(p).expect("真实 pptx 解析失败");
        let imgs: usize = r.slides.iter().map(|s| s.images.len()).sum();
        println!("耗时={:?} 页数={} 图片数={}", t0.elapsed(), r.slide_count, imgs);
    }
}
