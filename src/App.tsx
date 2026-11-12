// FileFly 应用外壳：布局、全局快捷键（技术文档 §9 交互规格）
import React, { useEffect, useRef, useState } from "react";
import { Sidebar } from "@/features/browser/Sidebar";
import { BrowserPane } from "@/features/browser/BrowserPane";
import { SpecialView } from "@/features/browser/SpecialView";
import { HomePage } from "@/features/home/HomePage";
import { TabsBar } from "@/features/tabs/TabsBar";
import { PreviewOverlay } from "@/features/preview/PreviewOverlay";
import { CommandPalette } from "@/features/commandPalette/CommandPalette";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { BatchRenameDialog } from "@/features/batchRename/BatchRenameDialog";
import { DuplicatesDialog } from "@/features/duplicates/DuplicatesDialog";
import { VaultView } from "@/features/vault/VaultView";
import { SearchResults } from "@/features/search/SearchResults";
import { useTabs, useClipboard, setHomePath } from "@/features/tabs/tabsStore";
import { useApp } from "@/features/settings/appStore";
import { usePreview } from "@/features/preview/previewStore";
import { useTags } from "@/features/tags/tagStore";
import { ContextMenuProvider } from "@/components/ui";
import { DialogHost } from "@/components/dialog";
import { Icons } from "@/components/Icons";

export default function App() {
  const tabs = useTabs();
  const app = useApp();
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const activeTab = tabs.tabs.find((t) => t.id === tabs.activeTabId) ?? tabs.tabs[0];
  const path = activeTab?.path ?? "";

  // 主题初始化 + 真实用户目录回填（桌面/文档等收藏与首页主目录）
  useEffect(() => {
    const saved = localStorage.getItem("ff-theme");
    if (saved === "dark" || saved === "light") {
      document.documentElement.setAttribute("data-theme", saved);
    }
    useTags.getState().load();
    useApp.getState().loadSpecialDirs().then(() => {
      const d = useApp.getState().specialDirs;
      if (d?.home) setHomePath(d.home);
    });
  }, []);

  // 全局快捷键
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      // Ctrl+P 命令面板（§9）
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") { e.preventDefault(); app.toggleOpen("commandPaletteOpen"); return; }
      // Ctrl+F 聚焦搜索
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); searchRef.current?.focus(); return; }
      // Ctrl+Shift+D 双栏（§9）
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") { e.preventDefault(); tabs.toggleDualPane(); return; }
      // Ctrl+T 新标签
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "t") { e.preventDefault(); tabs.addTab(); return; }
      // Ctrl+B 折叠/展开左侧面板
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") { e.preventDefault(); app.toggleSidebar(); return; }
      // Ctrl+` 在当前目录打开 CMD 终端
      if (e.ctrlKey && e.key === "`") { e.preventDefault(); openTerminal(); return; }
      // Ctrl+H 隐藏文件
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") { e.preventDefault(); app.setShowHidden(!app.showHidden); return; }
      if (typing) return;
      // 剪切/复制/粘贴（F-01 剪切：待剪项置灰半透明，粘贴执行移动）
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") { useClipboard.getState().setClipboard("cut", app.selection); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") { useClipboard.getState().setClipboard("copy", app.selection); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        const cb = useClipboard.getState();
        if (cb.kind !== "none" && !path.startsWith("__")) {
          await useApp.getState().setSelection([]);
          await import("@/ipc/client").then(({ api }) =>
            api.fsOperation(cb.kind === "cut" ? "move" : "copy", cb.paths, path).then(() => window.dispatchEvent(new CustomEvent("ff-refresh")))
          );
          useClipboard.getState().clear();
        }
        return;
      }
      // 空格预览（F-13：选中即览）
      if (e.key === " " && app.selection.length > 0) {
        e.preventDefault();
        usePreview.getState().show([...app.selection], 0);
        return;
      }
      if (e.key === "Escape" && usePreview.getState().open) { usePreview.getState().close(); return; }
      // 数字键 1~8 快速打预设色标（§9 标签规格）
      if (/^[1-8]$/.test(e.key) && app.selection.length > 0) {
        const defs = useTags.getState().defs.slice(0, 8);
        const tag = defs[+e.key - 1];
        if (tag) {
          await import("@/ipc/client").then(({ api }) => api.tagAdd?.(app.selection[0], tag.name));
          window.dispatchEvent(new CustomEvent("ff-refresh"));
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app, tabs, path]);

  // 屏蔽 WebView2 原生右键菜单：其"刷新"= 整页重载会跳回首页。
  // 应用内空白处右键菜单由 BrowserPane 提供（刷新=仅重载当前目录）；输入框保留原生菜单（复制粘贴）。
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onCtx);
    return () => document.removeEventListener("contextmenu", onCtx);
  }, []);

  // 保险箱全屏遮罩入口（§9）
  const isVault = path === "__vault__";

  // 在当前浏览目录打开 CMD 终端（非真实目录时回退主目录）
  const openTerminal = async () => {
    const target = !path || path.startsWith("__") ? useApp.getState().specialDirs?.home : path;
    if (!target) return;
    try {
      await import("@/ipc/client").then(({ api }) => api.fsOpenTerminal(target));
    } catch (err) {
      const { alertDialog } = await import("@/components/dialog");
      alertDialog("打开终端失败", String(err), "error");
    }
  };

  return (
    <ContextMenuProvider>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <TabsBar />
        {/* 顶部全局搜索框（Ctrl+F，§9 80ms 防抖由 SearchResults 控制） */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: "var(--ff-bg-sidebar)" }} className="glass">
          <div className="search-pill">
            <Icons.Search size={15} />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && search.trim()) tabs.navigate(`__search__:${search.trim()}`, `搜索：${search.trim()}`); }}
              placeholder="搜索文件… 支持 拼音首字母 (xj) / 语法 (size:>100MB ext:pdf modified:today tag:工作)"
            />
          </div>
          <button
            className="btn-ghost"
            title={`在当前目录打开 CMD (Ctrl+\`)\n${path && !path.startsWith("__") ? path : "首页"}`}
            onClick={openTerminal}
          >
            <Icons.Terminal />
          </button>
          <button className="btn-ghost" title="设置" onClick={() => app.toggleOpen("settingsOpen")}><Icons.Settings /></button>
        </div>

        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <Sidebar />
          {isVault ? (
            <div style={{ flex: 1, minWidth: 0 }}><VaultView /></div>
          ) : path === "__home__" || path === "" ? (
            <div style={{ flex: 1, minWidth: 0 }}><HomePage /></div>
          ) : path.startsWith("__search__:") ? (
            <div style={{ flex: 1, minWidth: 0 }}><SearchResults query={path.slice(11)} /></div>
          ) : path.startsWith("__") ? (
            <div style={{ flex: 1, minWidth: 0 }}><SpecialView path={path} /></div>
          ) : tabs.dualPane ? (
            // 双栏模式（F-05）：Ctrl+Shift+D 切换，Tab 在两栏间焦点切换
            <div style={{ display: "flex", flex: 1, minWidth: 0 }} tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Tab") e.preventDefault(); }}>
              <BrowserPane side="left" />
              <div style={{ width: 1, background: "var(--ff-border)" }} />
              <BrowserPane side="right" />
            </div>
          ) : (
            <div style={{ flex: 1, minWidth: 0 }}><BrowserPane side="left" /></div>
          )}
        </div>
      </div>

      {/* 浮层 */}
      <DialogHost />
      <PreviewOverlay />
      <CommandPalette />
      <SettingsPage />
      <BatchRenameDialog />
      {app.duplicatesOpen && <DuplicatesDialog />}
    </ContextMenuProvider>
  );
}
