// 浏览面板：工具栏 + 面包屑 + FileList（F-01/F-02/F-08 + §9 交互规格）
import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/ipc/client";
import { confirmDialog, promptDialog, alertDialog } from "@/components/dialog";
import type { EntryMeta } from "@/ipc/types";
import { fmtSize } from "@/ipc/types";
import { FileList } from "./FileList";
import { useApp } from "@/features/settings/appStore";
import { useTabs, useClipboard } from "@/features/tabs/tabsStore";
import { usePreview } from "@/features/preview/previewStore";
import { openEntrySmart } from "@/utils/openEntry";
import { useContextMenu, type MenuItem, LoadingHint, SkeletonRows } from "@/components/ui";
import { Icons } from "@/components/Icons";

const FILTERS: { key: "today" | "large" | "duplicate"; label: string }[] = [
  { key: "today", label: "今日修改" },
  { key: "large", label: "大文件" },
  { key: "duplicate", label: "重复文件" },
];

export const BrowserPane: React.FC<{ side: "left" | "right"; tabId?: string; active?: boolean }> = ({ side, tabId, active = true }) => {
  const tabs = useTabs();
  // keep-alive 多实例：传入 tabId 时绑定到该 tab（后台 tab 常驻，切换不销毁）；否则按侧栏解析（双栏右栏）
  const tab = tabId
    ? tabs.tabs.find((t) => t.id === tabId) ?? tabs.tabs[0]
    : side === "left"
      ? tabs.tabs.find((t) => t.id === tabs.activeTabId) ?? tabs.tabs[0]
      : tabs.rightTabs.find((t) => t.id === tabs.rightActiveTabId) ?? tabs.rightTabs[0];
  // 面板内部导航：绑定 tabId 时定向到该 tab，不打扰激活 tab
  const nav = (path: string, title?: string) =>
    tabId ? tabs.navigateTab(tabId, path, title) : tabs.navigateIn(side, path, title);
  const goBack = () => (tabId ? tabs.backTab(tabId) : tabs.backIn(side));
  const goForward = () => (tabId ? tabs.forwardTab(tabId) : tabs.forwardIn(side));
  const [entries, setEntries] = useState<EntryMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const app = useApp();
  const clipboard = useClipboard();

  const load = useCallback(async () => {
    if (!tab || tab.path.startsWith("__")) return;
    setLoading(true);
    try {
      const { entries: list } = await api.fsList(tab.path, {
        showHidden: app.showHidden,
        sort: app.sortField,
        order: app.sortOrder,
      });
      // F-08 筛选器
      const filtered = list.filter((e) => {
        if (app.filter === "today") return Date.now() - e.mtime < 86400000;
        if (app.filter === "large") return e.size > 100 * 1024 * 1024;
        if (app.filter === "duplicate") return false; // 重复文件走专页
        return true;
      });
      setEntries(filtered);
    } finally {
      setLoading(false);
    }
  }, [tab?.path, app.showHidden, app.sortField, app.sortOrder, app.filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onRefresh = () => load();
    window.addEventListener("ff-refresh", onRefresh);
    return () => window.removeEventListener("ff-refresh", onRefresh);
  }, [load]);

  // 外部变更自动刷新：轮询目录 mtime（2.5s），变化即重载（真实资源管理器行为的最简等价）
  const lastMtime = useRef(0);
  useEffect(() => { lastMtime.current = 0; }, [tab?.path]);
  useEffect(() => {
    if (!tab || tab.path.startsWith("__")) return;
    const timer = setInterval(async () => {
      try {
        const st = await api.fsStat(tab.path);
        if (st.mtime && lastMtime.current && st.mtime !== lastMtime.current) load();
        lastMtime.current = st.mtime || lastMtime.current;
      } catch { /* 目录被删除等，忽略 */ }
    }, 2500);
    return () => clearInterval(timer);
  }, [tab?.path, load]);

  // 键盘操作（真实资源管理器习惯）：F2 重命名 / Delete 删除 / Ctrl+A 全选 / Enter 打开 / Backspace 上级
  useEffect(() => {
    const onKey = async (ev: KeyboardEvent) => {
      if (!active) return; // 后台 tab 的面板不响应键盘（否则全局选区会被隐藏面板重复处理）
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (ev.target as HTMLElement)?.isContentEditable) return;
      if (usePreview.getState().open) return; // 预览打开时按键由预览层处理
      const sel = useApp.getState().selection;
      if (ev.key === "F2" && sel.length === 1) {
        ev.preventDefault();
        const entry = entries.find((e) => e.path === sel[0]);
        if (entry) {
          const name = await promptDialog("重命名", { value: entry.name, confirmText: "重命名" });
          if (name && name !== entry.name) api.fsOperation("rename", [entry.path], name).then(() => window.dispatchEvent(new CustomEvent("ff-refresh")));
        }
      } else if (ev.key === "Delete" && sel.length > 0) {
        ev.preventDefault();
        const ok = await confirmDialog("移入回收站", `确定将选中的 ${sel.length} 个项目移入回收站？`, { danger: true, confirmText: "移入回收站" });
        if (ok) {
          api.fsOperation("delete", sel).then(() => { useApp.getState().setSelection([]); window.dispatchEvent(new CustomEvent("ff-refresh")); });
        }
      } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") {
        ev.preventDefault();
        useApp.getState().setSelection(entries.map((e) => e.path));
      } else if (ev.key === "Enter" && sel.length > 0) {
        ev.preventDefault();
        const entry = entries.find((e) => e.path === sel[0]);
        if (entry) openEntry(entry);
      } else if (ev.key === "Backspace" && tab && !tab.path.startsWith("__")) {
        const crumbs = tab.path.split("\\").filter(Boolean);
        if (crumbs.length > 1) { ev.preventDefault(); nav(crumbs.slice(0, -1).join("\\")); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!tab || tab.path.startsWith("__")) return null;

  // 真实 Windows 行为：双击目录进入；双击可执行文件（exe/msi…）直接运行安装；其余进内置 QuickLook 预览。
  const openEntry = (e: EntryMeta) => {
    void openEntrySmart(e.path, e.isDir, () => nav(e.path));
  };

  const crumbs = tab.path.split("\\").filter(Boolean);
  const parentPath = crumbs.slice(0, -1).join("\\");

  // 空白处右键菜单：应用内"刷新"只重载当前目录（屏蔽 WebView 原生"刷新"导致的整页跳回首页）
  const { open: openCtx } = useContextMenu();

  // 新建条目（文件夹/各类文件）：重名由后端自动追加 (2)(3)
  const createEntry = async (kind: "mkdir" | "newFile", defaultName: string) => {
    const name = await promptDialog(kind === "mkdir" ? "新建文件夹" : "新建文件", { value: defaultName, confirmText: "创建" });
    if (!name?.trim()) return;
    try {
      await api.fsOperation(kind, [name.trim()], tab.path);
      load();
    } catch (err) {
      void alertDialog("创建失败", String(err));
    }
  };

  // 常用新建文件类型（与 Windows 资源管理器右键"新建"对齐；空文件均可被对应程序正常打开）
  const newFileTypes: { label: string; name: string }[] = [
    { label: "文本文档", name: "新建文本文档.txt" },
    { label: "Markdown", name: "新建文档.md" },
    { label: "Word 文档", name: "新建文档.docx" },
    { label: "Excel 表格", name: "新建表格.xlsx" },
    { label: "PowerPoint 演示", name: "新建演示.pptx" },
    { label: "CSV 表格", name: "新建表格.csv" },
    { label: "HTML 页面", name: "新建页面.html" },
    { label: "JSON 数据", name: "新建数据.json" },
    { label: "批处理脚本", name: "新建脚本.bat" },
  ];

  const blankMenu = (): MenuItem[] => [
    { label: "刷新", icon: <Icons.Refresh />, onClick: () => load() },
    { separator: true },
    {
      label: "新建",
      icon: <Icons.FilePlus size={15} />,
      submenu: [
        { label: "文件夹", icon: <Icons.Folder size={15} />, onClick: () => createEntry("mkdir", "新建文件夹") },
        { separator: true },
        ...newFileTypes.map((t) => ({ label: t.label, onClick: () => createEntry("newFile", t.name) })),
      ],
    },
    { label: "粘贴", icon: <Icons.Paste />, disabled: clipboard.paths.length === 0, onClick: paste },
    { label: "全部选中", onClick: () => useApp.getState().setSelection(entries.map((e) => e.path)) },
  ];

  // 地址栏：点击可编辑，支持直接输入完整路径回车跳转（真实资源管理器行为）
  const [addrEditing, setAddrEditing] = useState(false);
  const [addrDraft, setAddrDraft] = useState("");

  // 拖拽移动到目录（面包屑节点 / 空白处=当前目录）
  const moveHere = async (destDir: string, ev: React.DragEvent) => {
    ev.preventDefault();
    const raw = ev.dataTransfer.getData("text/filefly-paths");
    if (!raw) return;
    try {
      const paths = (JSON.parse(raw) as string[]).filter((p) => {
        const parent = p.split(/[\\/]/).slice(0, -1).join("\\");
        return parent !== destDir && !destDir.startsWith(p); // 已在本目录/拖入自身子目录则忽略
      });
      if (paths.length === 0) return;
      await api.fsOperation("move", paths, destDir);
      useApp.getState().setSelection([]);
      load();
    } catch { /* ignore */ }
  };
  const breadcrumbDrop = (destDir: string) => ({
    onDragOver: (ev: React.DragEvent) => {
      if (ev.dataTransfer.types.includes("text/filefly-paths")) { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; }
    },
    onDrop: (ev: React.DragEvent) => moveHere(destDir, ev),
  });

  const paste = async () => {
    if (clipboard.kind === "none") return;
    await api.fsOperation(clipboard.kind === "cut" ? "move" : "copy", clipboard.paths, tab.path);
    clipboard.clear();
    useApp.getState().setSelection([]);
    load();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0, flex: 1 }}>
      {/* 工具栏 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderBottom: "1px solid var(--ff-border)" }}>
        {tabs.dualPane && (
          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "var(--ff-bg-selected)", color: "var(--ff-primary)", fontWeight: 600, flexShrink: 0 }}>
            {side === "left" ? "左栏" : "右栏"}
          </span>
        )}
        <button className="btn-ghost" onClick={() => goBack()} title="后退"><Icons.Back /></button>
        <button className="btn-ghost" onClick={() => goForward()} title="前进"><Icons.Forward /></button>
        <button className="btn-ghost" onClick={() => parentPath && nav(parentPath)} title="上一级"><Icons.Up /></button>
        <button className="btn-ghost" onClick={load} title="刷新"><Icons.Refresh /></button>

        {/* 面包屑地址栏：点击编辑可输入路径；节点可接收拖放移动 */}
        {addrEditing ? (
          <input
            autoFocus
            value={addrDraft}
            onChange={(e) => setAddrDraft(e.target.value)}
            onBlur={() => setAddrEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && addrDraft.trim()) { setAddrEditing(false); nav(addrDraft.trim()); }
              if (e.key === "Escape") setAddrEditing(false);
            }}
            style={{
              flex: 1, padding: "5px 10px", fontSize: 13, outline: "none",
              background: "var(--ff-bg-content)", color: "var(--ff-text-primary)",
              border: "1px solid var(--ff-primary)", borderRadius: 8,
            }}
          />
        ) : (
          <div
            onClick={() => { setAddrDraft(tab.path); setAddrEditing(true); }}
            style={{
              flex: 1, display: "flex", alignItems: "center", gap: 2, padding: "5px 10px", fontSize: 13,
              background: "var(--ff-bg-content)", border: "1px solid var(--ff-border)", borderRadius: 8,
              overflow: "hidden", whiteSpace: "nowrap", cursor: "text",
            }}
          >
            {crumbs.map((c, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span style={{ color: "var(--ff-text-disabled)" }}>›</span>}
                <span
                  style={{ cursor: "pointer", color: i === crumbs.length - 1 ? "var(--ff-text-primary)" : "var(--ff-text-secondary)", padding: "1px 4px", borderRadius: 4 }}
                  onClick={(ev) => { ev.stopPropagation(); nav(crumbs.slice(0, i + 1).join("\\")); }}
                  {...breadcrumbDrop(crumbs.slice(0, i + 1).join("\\"))}
                >
                  {c}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}

        <button className="btn-ghost" title="新建文件夹" onClick={async () => {
          const name = await promptDialog("新建文件夹", { value: "新建文件夹", confirmText: "创建" });
          if (name) { await api.fsOperation("mkdir", [name], tab.path); load(); }
        }}><Icons.Folder size={16} color="currentColor" /></button>
        <button className="btn-ghost" title="剪切 (Ctrl+X)" onClick={() => clipboard.setClipboard("cut", app.selection)}><Icons.Cut /></button>
        <button className="btn-ghost" title="复制 (Ctrl+C)" onClick={() => clipboard.setClipboard("copy", app.selection)}><Icons.Copy /></button>
        <button className="btn-ghost" title="粘贴 (Ctrl+V)" onClick={paste}><Icons.Paste /></button>
        <button className="btn-ghost" title="批量重命名" onClick={() => app.toggleOpen("batchRenameOpen")}><Icons.Rename /></button>

        {/* 视图切换（F-02）+ 筛选器（F-08）+ 双栏（F-05，渐进式露出） */}
        <select
          value={app.viewMode}
          onChange={(e) => app.setViewMode(e.target.value as "list" | "grid" | "details")}
          style={{ background: "var(--ff-bg-card)", color: "var(--ff-text-primary)", border: "1px solid var(--ff-border)", borderRadius: 8, padding: "4px 8px", fontSize: 12 }}
        >
          <option value="list">列表</option>
          <option value="grid">宫格</option>
          <option value="details">详情</option>
        </select>
        <select
          value={app.sortField}
          onChange={(e) => app.setSort(e.target.value as "name" | "size" | "mtime" | "ext")}
          style={{ background: "var(--ff-bg-card)", color: "var(--ff-text-primary)", border: "1px solid var(--ff-border)", borderRadius: 8, padding: "4px 8px", fontSize: 12 }}
        >
          <option value="name">按名称</option>
          <option value="size">按大小</option>
          <option value="mtime">按日期</option>
          <option value="ext">按类型</option>
        </select>
        <div style={{ display: "flex", gap: 4 }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className="btn-ghost"
              style={app.filter === f.key ? { background: "var(--ff-bg-selected)", color: "var(--ff-primary)" } : undefined}
              onClick={() => app.setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          className="btn-ghost"
          title="双栏模式 (Ctrl+Shift+D)"
          style={tabs.dualPane ? { background: "var(--ff-bg-selected)", color: "var(--ff-primary)" } : undefined}
          onClick={tabs.toggleDualPane}
        >
          <Icons.Dual />
        </button>
      </div>

      {/* 文件区（空白处可接收拖放=移入当前目录；右键=应用内刷新/新建/粘贴菜单） */}
      <div
        style={{ flex: 1, minHeight: 0, background: "var(--ff-bg-content)", position: "relative" }}
        onContextMenu={(ev) => {
          // 仅空白处（目标不是文件行时）弹应用内菜单；文件行的菜单由 FileList 自行处理
          const t = ev.target as HTMLElement;
          if (t.closest("[data-file-row]")) return;
          openCtx(ev, blankMenu());
        }}
        onDragOver={(ev) => {
          if (ev.dataTransfer.types.includes("text/filefly-paths")) { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; }
        }}
        onDrop={(ev) => moveHere(tab.path, ev)}
      >
        {loading && entries.length === 0 ? (
          <div>
            <LoadingHint text="正在读取目录…" padding={24} />
            <SkeletonRows rows={7} />
          </div>
        ) : (
          <FileList entries={entries} onOpen={openEntry} />
        )}
      </div>

      {/* 底部状态条：常规布局行（不再浮在列表上），滚动到底时最后一行完整可见 */}
      <div
        style={{
          flexShrink: 0, padding: "5px 14px", fontSize: 12, color: "var(--ff-text-secondary)",
          background: "var(--ff-bg-sidebar)", borderTop: "1px solid var(--ff-border)",
        }}
      >
        共 {entries.length} 项{app.selection.length > 0 && ` · 已选 ${app.selection.length} 项 · ${fmtSize(entries.filter((e) => app.selection.includes(e.path)).reduce((s, e) => s + e.size, 0))}`}
      </div>
    </div>
  );
};
