// 命令面板（P1：Ctrl+P / Cmd+P，类 VS Code / Raycast）
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/features/settings/appStore";
import { useTabs } from "@/features/tabs/tabsStore";
import { api } from "@/ipc/client";
import type { SearchHit } from "@/ipc/types";
import { Icons } from "@/components/Icons";

interface Command {
  id: string;
  title: string;
  hint?: string;
  run: () => void;
}

export const CommandPalette: React.FC = () => {
  const open = useApp((s) => s.commandPaletteOpen);
  const toggleOpen = useApp((s) => s.toggleOpen);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ(""); setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const commands: Command[] = useMemo(() => [
    { id: "home", title: "打开首页", run: () => useTabs.getState().navigate("__home__", "首页") },
    { id: "recent", title: "最近使用", run: () => useTabs.getState().navigate("__recent__", "最近使用") },
    { id: "vault", title: "打开保险箱", hint: "隐私 · AES-256", run: () => useTabs.getState().navigate("__vault__", "保险箱") },
    { id: "dualpane", title: "切换双栏模式", hint: "Ctrl+Shift+D", run: () => useTabs.getState().toggleDualPane() },
    { id: "theme", title: "切换深浅色主题", run: () => useApp.getState().setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark") },
    { id: "batchrename", title: "批量重命名", run: () => useApp.getState().toggleOpen("batchRenameOpen") },
    { id: "duplicates", title: "重复文件查找", run: () => useApp.getState().toggleOpen("duplicatesOpen") },
    { id: "settings", title: "打开设置", run: () => useApp.getState().toggleOpen("settingsOpen") },
    { id: "grid", title: "视图：宫格", run: () => useApp.getState().setViewMode("grid") },
    { id: "list", title: "视图：列表", run: () => useApp.getState().setViewMode("list") },
    { id: "details", title: "视图：详情列", run: () => useApp.getState().setViewMode("details") },
    { id: "newtab", title: "新建标签页", hint: "Ctrl+T", run: () => useTabs.getState().addTab() },
  ], []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const cmds = commands.filter((c) => !t || c.title.toLowerCase().includes(t));
    return { cmds, isSearch: t.length > 0 && !t.startsWith(">") };
  }, [q, commands]);

  useEffect(() => {
    // 命令面板输入超过 1 字符时实时搜索（复用搜索索引，F-09）
    if (!filtered.isSearch || !q.trim()) { setHits([]); return; }
    const t = setTimeout(() => {
      api.searchQuery({ text: q.trim() }, 8).then(setHits).catch(() => {});
    }, 80);
    return () => clearTimeout(t);
  }, [q, filtered.isSearch]);

  if (!open) return null;
  const total = filtered.cmds.length + hits.length;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 950, background: "rgba(0,0,0,.3)" }}
      onClick={(e) => { if (e.target === e.currentTarget) toggleOpen("commandPaletteOpen"); }}>
      <div className="preview-overlay" style={{
        width: 560, margin: "12vh auto", background: "var(--ff-bg-card)", border: "1px solid var(--ff-border)",
        borderRadius: 12, boxShadow: "0 24px 80px rgba(0,0,0,.35)", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--ff-border)" }}>
          <Icons.Command />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setCursor(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(total - 1, c + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
              else if (e.key === "Enter") {
                e.preventDefault();
                const cmds = filtered.cmds;
                if (cursor < cmds.length) cmds[cursor]?.run();
                else {
                  const hit = hits[cursor - cmds.length];
                  if (hit) { useTabs.getState().navigate(hit.isDir ? hit.path : hit.path.split(/[\\/]/).slice(0, -1).join("\\")); }
                }
                toggleOpen("commandPaletteOpen");
              } else if (e.key === "Escape") toggleOpen("commandPaletteOpen");
            }}
            placeholder="输入命令，或直接搜索文件…"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--ff-text-primary)", fontSize: 15 }}
          />
          <span style={{ fontSize: 11, color: "var(--ff-text-disabled)" }}>Esc 关闭</span>
        </div>
        <div style={{ maxHeight: 380, overflowY: "auto", padding: 6 }}>
          {filtered.cmds.map((c, i) => (
            <CmdRow key={c.id} active={cursor === i} onClick={() => { c.run(); toggleOpen("commandPaletteOpen"); }}>
              <Icons.Command size={14} /> {c.title}
              {c.hint && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ff-text-disabled)" }}>{c.hint}</span>}
            </CmdRow>
          ))}
          {hits.map((h, i) => (
            <CmdRow key={h.path} active={cursor === filtered.cmds.length + i}
              onClick={() => { useTabs.getState().navigate(h.isDir ? h.path : h.path.split(/[\\/]/).slice(0, -1).join("\\")); toggleOpen("commandPaletteOpen"); }}>
              {h.isDir ? <Icons.Folder size={14} /> : <Icons.File size={14} />} {h.name}
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ff-text-disabled)" }}>文件</span>
            </CmdRow>
          ))}
        </div>
      </div>
    </div>
  );
};

const CmdRow: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <div onClick={onClick}
    style={{
      display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, fontSize: 13, cursor: "pointer",
      background: active ? "var(--ff-bg-selected)" : "transparent", color: active ? "var(--ff-primary)" : "var(--ff-text-primary)",
    }}>
    {children}
  </div>
);
