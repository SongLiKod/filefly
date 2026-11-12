#!/usr/bin/env node
/**
 * FileFly 主题令牌生成器（技术文档 §8.7）
 * 单一来源 packages/theme-tokens/tokens.json →
 *   1. src/theme/tokens.css   （CSS 变量，前端运行时深浅色切换，零重建）
 *   2. src-tauri/src/theme_tokens.rs （Rust 常量，窗口底色，避免启动闪白）
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(readFileSync(resolve(root, "packages/theme-tokens/tokens.json"), "utf8"));

// ---------- tokens.css ----------
const cssVar = (k) => "--ff-" + k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
const themeBlock = (t) =>
  Object.entries(t)
    .map(([k, v]) => `  ${cssVar(k)}: ${v};`)
    .join("\n");

const css = `/* 由 scripts/gen-tokens.mjs 自动生成，来源：packages/theme-tokens/tokens.json。请勿手改。 */
:root, html[data-theme="light"] {
${themeBlock(tokens.themes.light)}
  --ff-logo-gradient: ${tokens.meta.logoGradient};
  --ff-glass: ${tokens.effects.glass};
}
html[data-theme="dark"] {
${themeBlock(tokens.themes.dark)}
}
html { color-scheme: light; }
html[data-theme="dark"] { color-scheme: dark; }
* { transition: background-color var(--ff-theme-switch, 150ms) ease, color var(--ff-theme-switch, 150ms) ease, border-color var(--ff-theme-switch, 150ms) ease; }
`;

mkdirSync(resolve(root, "src/theme"), { recursive: true });
writeFileSync(resolve(root, "src/theme/tokens.css"), css);

// ---------- tokens.rs ----------
const rsConst = (theme) =>
  Object.entries(tokens.themes[theme])
    .map(([k, v]) => {
      const name = k.replace(/[A-Z]/g, (m) => "_" + m.toUpperCase()).toUpperCase();
      let val = v;
      // rgba() → 0xAABBGGRR 便于 Win32/Tao 窗口底色
      const rgba = v.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
      if (rgba) {
        const [r, g, b, a] = [+rgba[1], +rgba[2], +rgba[3], Math.round(+rgba[4] * 255)];
        val = `0x${((a << 24) | (b << 16) | (g << 8) | r).toString(16).padStart(8, "0")}`;
      }
      return `pub const ${theme.toUpperCase()}_${name}: &str = "${v}";`;
    })
    .join("\n");

const rs = `// 由 scripts/gen-tokens.mjs 自动生成，来源：packages/theme-tokens/tokens.json。请勿手改。
// 用途：Tauri 窗口创建时设置底色，避免启动闪白（技术文档 §8.7）。

${rsConst("light")}

${rsConst("dark")}

pub fn window_background_hex(theme: &str) -> &'static str {
    if theme == "dark" { DARK_BG_APP } else { LIGHT_BG_APP }
}
`;

mkdirSync(resolve(root, "src-tauri/src"), { recursive: true });
writeFileSync(resolve(root, "src-tauri/src/theme_tokens.rs"), rs);

console.log("✓ generated src/theme/tokens.css");
console.log("✓ generated src-tauri/src/theme_tokens.rs");
