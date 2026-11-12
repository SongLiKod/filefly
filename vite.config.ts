import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// FileFly 前端构建配置（Tauri v2 官方推荐 Vite 5）
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    // Tauri 环境约定：构建产物接入 src-tauri/dist
    target: "chrome110",
    outDir: "dist",
    assetsDir: "assets",
    chunkSizeWarningLimit: 1500,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@theme": path.resolve(__dirname, "packages/theme-tokens"),
    },
  },
  // 缩略图/预览二进制流走自定义协议 ff://（技术文档 §1）
  // 浏览器 dev 模式下由 ipc/mock 提供数据 URL 兜底
});
