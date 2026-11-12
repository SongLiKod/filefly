// 由 scripts/gen-tokens.mjs 自动生成，来源：packages/theme-tokens/tokens.json。请勿手改。
// 用途：Tauri 窗口创建时设置底色，避免启动闪白（技术文档 §8.7）。

pub const LIGHT_PRIMARY: &str = "#2E6BE6";
pub const LIGHT_PRIMARY_HOVER: &str = "#1F5AD1";
pub const LIGHT_PRIMARY_ACTIVE: &str = "#1749B8";
pub const LIGHT_ACCENT: &str = "#00B8C4";
pub const LIGHT_SUCCESS: &str = "#1F9D55";
pub const LIGHT_WARNING: &str = "#D97706";
pub const LIGHT_DANGER: &str = "#DC2626";
pub const LIGHT_BG_APP: &str = "#F3F6FC";
pub const LIGHT_BG_SIDEBAR: &str = "rgba(246,249,255,.86)";
pub const LIGHT_BG_CONTENT: &str = "#FFFFFF";
pub const LIGHT_BG_CARD: &str = "#FFFFFF";
pub const LIGHT_BG_HOVER: &str = "rgba(46,107,230,.07)";
pub const LIGHT_BG_SELECTED: &str = "rgba(46,107,230,.15)";
pub const LIGHT_BORDER: &str = "#DDE4F2";
pub const LIGHT_TEXT_PRIMARY: &str = "#171A21";
pub const LIGHT_TEXT_SECONDARY: &str = "#5A6478";
pub const LIGHT_TEXT_DISABLED: &str = "#9AA3B5";
pub const LIGHT_HIGHLIGHT: &str = "#FFE58F";
pub const LIGHT_HIGHLIGHT_TEXT: &str = "#1A1D22";

pub const DARK_PRIMARY: &str = "#4C8DFF";
pub const DARK_PRIMARY_HOVER: &str = "#3D7BE8";
pub const DARK_PRIMARY_ACTIVE: &str = "#2E66C9";
pub const DARK_ACCENT: &str = "#22D3D9";
pub const DARK_SUCCESS: &str = "#2ECC71";
pub const DARK_WARNING: &str = "#F59E0B";
pub const DARK_DANGER: &str = "#EF4444";
pub const DARK_BG_APP: &str = "#0E1116";
pub const DARK_BG_SIDEBAR: &str = "rgba(14,17,22,.84)";
pub const DARK_BG_CONTENT: &str = "#161A20";
pub const DARK_BG_CARD: &str = "#1D222B";
pub const DARK_BG_HOVER: &str = "rgba(76,141,255,.12)";
pub const DARK_BG_SELECTED: &str = "rgba(76,141,255,.20)";
pub const DARK_BORDER: &str = "#2A303C";
pub const DARK_TEXT_PRIMARY: &str = "#EAECF2";
pub const DARK_TEXT_SECONDARY: &str = "#98A2B8";
pub const DARK_TEXT_DISABLED: &str = "#5A6478";
pub const DARK_HIGHLIGHT: &str = "#8A6D00";
pub const DARK_HIGHLIGHT_TEXT: &str = "#FFFFFF";

pub fn window_background_hex(theme: &str) -> &'static str {
    if theme == "dark" { DARK_BG_APP } else { LIGHT_BG_APP }
}
