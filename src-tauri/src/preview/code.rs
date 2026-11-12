// 代码/文本预览（技术文档 §6：流式读前 5MB，Tree-sitter → token 流，前端 Shiki 渲染）
use serde::Serialize;
use std::path::Path;

const MAX_STREAM_BYTES: usize = 5 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodePreview {
    pub language: String,
    pub text: String,
    pub truncated: bool,
    pub total_size: u64,
    pub line_count: usize,
    pub highlight_spans: Vec<HighlightSpan>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HighlightSpan {
    pub start: usize,
    pub end: usize,
    pub kind: String, // keyword | string | comment | number | function | type
}

/// 语言探测（扩展名 → tree-sitter grammar 名）
pub fn detect_language(ext: &str) -> &'static str {
    match ext {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "py" => "python",
        "go" => "go",
        "java" => "java",
        "c" | "h" => "c",
        "cpp" | "hpp" | "cc" => "cpp",
        "cs" => "csharp",
        "md" => "markdown",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "html" | "htm" => "html",
        "css" | "scss" => "css",
        "sql" => "sql",
        "sh" | "bash" | "ps1" => "bash",
        "toml" => "toml",
        _ => "text",
    }
}

/// 二进制嗅探：文本预览绝不接收二进制数据。
/// 此前无防护时，路由漏洞会让 9MB 的 pptx/xlsx 二进制被当文本返回，
/// 前端按 \n 渲染出几十万行 div 直接把 webview 卡死。
fn looks_binary(buf: &[u8]) -> bool {
    let sample = &buf[..buf.len().min(8192)];
    // 含 NUL 几乎必为二进制
    if sample.contains(&0) {
        return true;
    }
    // 除 \t \r \n 外的控制字节占比 > 5% 判为二进制（>=0x80 视为多字节文本如 UTF-8/GBK）
    let ctrl = sample
        .iter()
        .filter(|&&b| b < 9 || b == 11 || b == 12 || (14..32).contains(&b) || b == 127)
        .count();
    ctrl * 20 > sample.len()
}

/// 流式读取 + 轻量 token 高亮（MVP：内置扫描器出 token 流；M2 换 Tree-sitter 增量解析）
pub fn read_code(path: &str, ext: &str) -> Result<CodePreview, String> {
    let meta = std::fs::metadata(Path::new(path)).map_err(|e| e.to_string())?;
    let total = meta.len();
    use std::io::Read;
    let mut f = std::fs::File::open(Path::new(path)).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; MAX_STREAM_BYTES.min(total as usize)];
    f.read_exact(&mut buf).map_err(|e| e.to_string())?;
    if looks_binary(&buf) {
        return Err("BINARY_FILE: 二进制文件不支持文本预览，请用系统默认程序打开".into());
    }
    let text = String::from_utf8_lossy(&buf).to_string();
    let language = detect_language(ext).to_string();
    let spans = if language == "text" {
        vec![]
    } else {
        scan_highlight(&text)
    };
    Ok(CodePreview {
        language,
        truncated: total > buf.len() as u64,
        total_size: total,
        line_count: text.lines().count(),
        text,
        highlight_spans: spans,
    })
}

/// 词法扫描高亮：关键字/字符串/注释/数字（够预览用；Tree-sitter 在 M2 替换）
fn scan_highlight(text: &str) -> Vec<HighlightSpan> {
    const KEYWORDS: &[&str] = &[
        "fn", "let", "const", "var", "pub", "use", "if", "else", "for", "while", "return",
        "class", "struct", "enum", "impl", "match", "import", "export", "from", "def", "async",
        "await", "function", "type", "interface", "new", "this", "self", "public", "private",
    ];
    let mut spans = Vec::new();
    let mut chars = text.char_indices().peekable();
    let bytes = text.as_bytes();
    while let Some((i, c)) = chars.next() {
        if c == '"' || c == '\'' {
            let start = i;
            for (j, c2) in chars.by_ref() {
                if c2 == c { spans.push(HighlightSpan { start, end: j + 1, kind: "string".into() }); break; }
            }
        } else if c == '/' && bytes.get(i + 1) == Some(&b'/') {
            let start = i;
            while let Some((j, c2)) = chars.next() {
                if c2 == '\n' { spans.push(HighlightSpan { start, end: j, kind: "comment".into() }); break; }
            }
        } else if c.is_ascii_digit() {
            let start = i;
            while let Some(&(j, c2)) = chars.peek() {
                if !c2.is_ascii_digit() && c2 != '.' { break; }
                chars.next();
                if c2.is_ascii_digit() || c2 == '.' {
                    let _ = j;
                } else { break; }
            }
            spans.push(HighlightSpan { start, end: chars.peek().map(|(j, _)| *j).unwrap_or(bytes.len()), kind: "number".into() });
        } else if c.is_alphabetic() || c == '_' {
            let start = i;
            while let Some(&(j, c2)) = chars.peek() {
                if !(c2.is_alphanumeric() || c2 == '_') { break; }
                chars.next();
                let _ = j;
            }
            let end = chars.peek().map(|(j, _)| *j).unwrap_or(bytes.len());
            let word = &text[start..end];
            if KEYWORDS.contains(&word) {
                spans.push(HighlightSpan { start, end, kind: "keyword".into() });
            }
        }
    }
    spans
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_sniff_rejects_executables_and_office() {
        // PE 头（exe/dll）
        let mut pe = vec![0x4Du8, 0x5A];
        pe.extend(std::iter::repeat(0u8).take(4096));
        assert!(looks_binary(&pe));
        // OOXML/OLE2
        let mut ole = vec![0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
        ole.extend(std::iter::repeat(0u8).take(4096));
        assert!(looks_binary(&ole));
        // 纯 NUL 块
        assert!(looks_binary(&vec![0u8; 1024]));
    }

    #[test]
    fn binary_sniff_accepts_text_and_cjk() {
        assert!(!looks_binary(b"fn main() { println!(\"hi\"); }\r\nlet x = 1;\n"));
        // UTF-8 中文（多字节 >= 0x80 不算控制字节）
        let cjk = "企业IM与OA使用培训培训文档，包含安装与升级说明。\r\n".repeat(100);
        assert!(!looks_binary(cjk.as_bytes()));
        // GBK 中文（字节 >= 0x80）
        let gbk: Vec<u8> = vec![0xC6, 0xD3, 0xB5, 0xC4, 0xCE, 0xC4, 0xB5, 0xB5, 0x0D, 0x0A].repeat(50);
        assert!(!looks_binary(&gbk));
    }
}
