// 临时验证：解析真实 pptx 并输出每页标题/前 3 条正文
fn main() {
    let path = std::env::args().nth(1).expect("usage: pptx_check <file.pptx>");
    let t0 = std::time::Instant::now();
    match filefly::preview::office::parse_office(&path) {
        Ok(p) => {
            println!("kind={} slideCount={} 耗时={}ms", p.kind, p.slide_count, t0.elapsed().as_millis());
            for s in p.slides.iter().take(6) {
                println!("\n— P{} 标题: {}", s.index, if s.title.is_empty() { "(无)" } else { &s.title });
                for t in s.texts.iter().take(3) { println!("   · {}", t); }
                if s.texts.len() > 3 { println!("   … 共 {} 条正文", s.texts.len()); }
            }
        }
        Err(e) => println!("ERR: {}", e),
    }
}
