// FileFly 入口（技术文档 §2：main.rs）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    filefly::run()
}
