// 文件列表：列表 / 自适应宫格 / 详情列三视图 + @tanstack/react-virtual 虚拟化（F-02/F-03）
// 纪律：游标分页 + 渐进渲染，前端不一次性持有 >2000 条（技术文档 §3）
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api } from "@/ipc/client";
import type { EntryMeta } from "@/ipc/types";
import { fmtSize, fmtDate } from "@/ipc/types";
import { useApp } from "@/features/settings/appStore";
import { useClipboard, useTabs } from "@/features/tabs/tabsStore";
import { usePreview } from "@/features/preview/previewStore";
import { useContextMenu, TagChip, type MenuItem } from "@/components/ui";
import { alertDialog, confirmDialog, promptDialog } from "@/components/dialog";
import { useTags } from "@/features/tags/tagStore";
import { Icons } from "@/components/Icons";


function fileIcon(e: EntryMeta, size: number) {
  const ext = e.ext ?? "";
  const c = (color: string) => <span style={{ color, display: "inline-flex" }}>{Icons.File({ size })}</span>;
  if (e.isDir) return <Icons.Folder size={size} />;
  if (["jpg", "png", "webp", "gif", "jpeg", "bmp", "svg", "heic"].includes(ext)) return c("#16A34A");
  if (["mp3", "flac", "wav", "ape", "ogg", "m4a"].includes(ext)) return c("#D946EF");
  if (["mp4", "mkv", "mov", "webm"].includes(ext)) return c("#7C3AED");
  if (["zip", "7z", "rar", "tar", "gz"].includes(ext)) return c("#D97706");
  if (["exe", "msi"].includes(ext)) return c("#EA580C");
  if (["pdf", "docx", "xlsx", "pptx", "doc", "md", "txt"].includes(ext)) return c("#2E6BE6");
  return c("var(--ff-text-secondary)");
}

const THUMB_CACHE = new Map<string, string>();

// 文件夹大小：会话级缓存（后端另有 5 分钟 TTL 缓存），in-flight 去重避免重复请求
const DIR_SIZE_MEMO = new Map<string, { size: number; partial: boolean }>();
const DIR_SIZE_INFLIGHT = new Set<string>();

/** 文件夹大小显示：未知=…；空文件夹=0 KB；截断=≥ 前缀 */
function dirSizeText(v: { size: number; partial: boolean } | undefined): string {
  if (!v) return "…";
  if (v.size === 0) return "0 KB";
  return (v.partial ? "≥ " : "") + fmtSize(v.size);
}

const Thumb: React.FC<{ entry: EntryMeta; size: number }> = ({ entry, size }) => {
  const [url, setUrl] = useState<string | null>(THUMB_CACHE.get(entry.path) ?? null);
  const isImg = entry.ext && ["jpg", "png", "webp", "gif", "jpeg", "bmp", "svg"].includes(entry.ext);
  useEffect(() => {
    if (!isImg) return;
    let alive = true;
    api.fsThumbnail(entry.path, entry.mtime).then((u) => {
      if (!alive) return;
      THUMB_CACHE.set(entry.path, u);
      setUrl(u);
    }).catch(() => {});
    return () => { alive = false; };
  }, [entry.path, entry.mtime, isImg]);
  if (isImg && url) {
    return <img src={url} alt={entry.name} loading="lazy" style={{ width: size, height: size, objectFit: "cover", borderRadius: 6 }} />;
  }
  return <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>{fileIcon(entry, Math.min(size, 28))}</div>;
};

export const FileList: React.FC<{
  entries: EntryMeta[];
  onOpen: (e: EntryMeta) => void;
  compact?: boolean;
}> = ({ entries, onOpen, compact }) => {
  const viewMode = useApp((s) => s.viewMode);
  const folderSize = useApp((s) => s.folderSize);
  const selection = useApp((s) => s.selection);
  const setSelection = useApp((s) => s.setSelection);
  const cutPaths = useApp((s) => s.cutPaths);
  const { open } = useContextMenu();
  const { defs } = useTags();
  const containerRef = useRef<HTMLDivElement>(null);
  const lastClickIndex = useRef(-1);

  // —— 文件夹大小（后台异步，不阻塞列表）：当前目录里的文件夹分批请求 ——
  const [dirSizes, setDirSizes] = useState<Map<string, { size: number; partial: boolean }>>(new Map());
  const showsSizeCol = viewMode === "details" || (viewMode === "list" && !compact);
  const dirPaths = useMemo(
    () => (folderSize && showsSizeCol ? entries.filter((e) => e.isDir).map((e) => e.path) : []),
    [entries, folderSize, showsSizeCol],
  );
  useEffect(() => {
    if (!folderSize) return;
    let alive = true;
    (async () => {
      const todo = dirPaths.filter((p) => !DIR_SIZE_MEMO.has(p) && !DIR_SIZE_INFLIGHT.has(p));
      if (todo.length === 0) {
        if (dirPaths.some((p) => DIR_SIZE_MEMO.has(p))) setDirSizes(new Map(DIR_SIZE_MEMO));
        return;
      }
      for (const p of todo) DIR_SIZE_INFLIGHT.add(p);
      try {
        for (let i = 0; i < todo.length; i += 64) {
          const res = await api.fsDirSizes(todo.slice(i, i + 64));
          for (const r of res) DIR_SIZE_MEMO.set(r.path, { size: r.size, partial: r.partial });
          if (alive) setDirSizes(new Map(DIR_SIZE_MEMO));
        }
      } catch { /* 后端不可用/已切换目录，静默 */ }
      finally { for (const p of todo) DIR_SIZE_INFLIGHT.delete(p); }
    })();
    return () => { alive = false; };
  }, [dirPaths, folderSize]);
  const dirSizeOf = (p: string): string | undefined =>
    folderSize ? dirSizeText(dirSizes.get(p) ?? DIR_SIZE_MEMO.get(p)) : undefined;

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => (viewMode === "list" ? (compact ? 32 : 40) : 0),
    overscan: 20,
  });

  // 定位请求（搜索结果"在新标签打开所在文件夹"）：滚动到目标文件并选中，随后清除请求
  const pendingReveal = useApp((s) => s.pendingReveal);
  useEffect(() => {
    if (!pendingReveal) return;
    const idx = entries.findIndex((e) => e.path === pendingReveal);
    if (idx < 0) return; // 目录尚未加载完成，等 entries 就绪后自动重试
    const target = pendingReveal;
    useApp.getState().setPendingReveal(null); // 先清除，避免后续刷新重复滚动
    useApp.getState().setSelection([target]);
    if (viewMode === "list") virtualizer.scrollToIndex(idx, { align: "center" });
    // 两帧等待：虚拟行渲染成 DOM 后精调居中（非虚拟视图直接生效）
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const sel = `[data-path="${target.replace(/["\\]/g, "\\$&")}"]`;
      containerRef.current?.querySelector(sel)?.scrollIntoView({ block: "center" });
    }));
  }, [pendingReveal, entries, viewMode]);

  const select = (e: EntryMeta, idx: number, multi: boolean, range: boolean) => {
    if (range && lastClickIndex.current >= 0) {
      const [a, b] = [lastClickIndex.current, idx].sort((x, y) => x - y);
      setSelection(entries.slice(a, b + 1).map((x) => x.path));
    } else if (multi) {
      const has = selection.includes(e.path);
      setSelection(has ? selection.filter((p) => p !== e.path) : [...selection, e.path]);
    } else {
      setSelection([e.path]);
    }
    lastClickIndex.current = idx;
  };

  // 拖拽数据：拖选中项时携带整个选区，否则只拖该项
  const dragPaths = (e: EntryMeta): string[] => {
    if (selection.includes(e.path) && selection.length > 0) return selection;
    return [e.path];
  };

  // 拖拽移动（真实 Windows 行为：拖到文件夹上=移动，拖到空白处=移入当前目录）
  const moveInto = async (destDir: string, paths: string[]) => {
    const filtered = paths.filter((p) => !destDir.startsWith(p));
    if (filtered.length === 0) return;
    await api.fsOperation("move", filtered, destDir);
    useApp.getState().setSelection([]);
    window.dispatchEvent(new CustomEvent("ff-refresh"));
  };

  const dropProps = (e: EntryMeta) =>
    e.isDir
      ? {
          onDragOver: (ev: React.DragEvent) => {
            if (ev.dataTransfer.types.includes("text/filefly-paths")) {
              ev.preventDefault();
              ev.dataTransfer.dropEffect = "move";
            }
          },
          onDrop: (ev: React.DragEvent) => {
            ev.preventDefault();
            ev.stopPropagation();
            const raw = ev.dataTransfer.getData("text/filefly-paths");
            if (raw) {
              try { moveInto(e.path, JSON.parse(raw)); } catch { /* ignore */ }
            }
          },
        }
      : {};

  // 右键菜单（F-01 操作 + F-19 标签子菜单 8 色 + 保险箱 + 复制路径）
  const entryMenu = (e: EntryMeta): MenuItem[] => [
    { label: "打开", icon: <Icons.Eye />, onClick: () => onOpen(e) },
    ...(e.isDir ? [] : [{ label: "用默认程序打开", icon: <Icons.Eye />, onClick: () => { api.fsOpen(e.path).catch(() => {}); } }]),
    { separator: true },
    { label: "剪切", icon: <Icons.Cut />, onClick: () => useClipboard.getState().setClipboard("cut", [e.path]) },
    { label: "复制", icon: <Icons.Copy />, onClick: () => useClipboard.getState().setClipboard("copy", [e.path]) },
    { label: "复制路径", icon: <Icons.Copy />, onClick: () => { navigator.clipboard.writeText(e.path).catch(() => {}); } },
    { label: "重命名", icon: <Icons.Pen />, onClick: () => renameInline(e) },
    { label: "删除", icon: <Icons.Trash />, onClick: () => del([e]) },
    { label: "移入保险箱", icon: <Icons.Lock size={15} />, onClick: () => toVault([e.path]) },
    {
      label: "标签",
      icon: <Icons.Tag />,
      submenu: defs
        .map((d) => ({
          // 已打标的标签显示勾选状态（再次点击=取消）
          label: (e.tags.includes(d.name) ? "✓ " : "") + d.name,
          icon: <span style={{ width: 10, height: 10, borderRadius: 5, background: d.color, display: "inline-block" }} />,
          onClick: async () => {
            await api.tagSet(e.path, e.tags.includes(d.name) ? e.tags.filter((t) => t !== d.name) : [...e.tags, d.name]);
            window.dispatchEvent(new CustomEvent("ff-refresh"));
          },
        })),
    },
    { separator: true },
    { label: "在资源管理器中显示", onClick: () => api.fsReveal(e.path).catch(() => {}) },
  ];

  const renameInline = async (_e: EntryMeta) => {
    // 内联重命名（F-01）
    const newName = await promptDialog("重命名", { value: _e.name, confirmText: "重命名" });
    if (newName && newName !== _e.name) {
      api.fsOperation("rename", [_e.path], newName).then(() => window.dispatchEvent(new CustomEvent("ff-refresh")));
    }
  };

  // 移入保险箱：需保险箱已创建；未解锁时先输入主密码解锁，再用主密钥加密存入（原文件移入回收站）
  const toVault = async (paths: string[]) => {
    try {
      const st = await api.vaultStatus();
      if (!st.created) {
        await alertDialog("保险箱未创建", "请先到左侧栏「保险箱」创建保险箱（设置主密码）后，再移入文件。", "warning");
        return;
      }
      if (st.locked) {
        const pw = await promptDialog("解锁保险箱", {
          message: `存入 ${paths.length} 个项目前需要先解锁保险箱，请输入主密码：`,
          password: true,
          confirmText: "解锁并存入",
        });
        if (!pw) return;
        try {
          await api.vaultUnlock(pw);
        } catch {
          await alertDialog("解锁失败", "主密码错误，请到侧栏「保险箱」确认后再试。", "error");
          return;
        }
      }
      const [n, errs] = await api.vaultAdd(paths);
      if (n > 0 && errs.length === 0) {
        await alertDialog("已存入保险箱", `已将 ${n} 个项目加密存入保险箱，原文件已移入系统回收站。可到侧栏「保险箱」查看。`, "success");
      } else if (n > 0) {
        await alertDialog("部分成功", `已存入 ${n} 个项目；以下失败：\n${errs.join("\n")}`, "warning");
      } else {
        await alertDialog("移入保险箱失败", errs.join("\n"), "error");
      }
      window.dispatchEvent(new CustomEvent("ff-refresh"));
    } catch (err) {
      await alertDialog("移入保险箱失败", String(err), "error");
    }
  };

  const del = (list: EntryMeta[]) => {
    const paths = list.map((x) => x.path);
    // 删除确认框（真实资源管理器习惯；确认后移入系统回收站，可恢复）
    void confirmDialog("移入回收站", `确定将选中的 ${paths.length} 个项目移入回收站吗？`, { danger: true, confirmText: "移入回收站" })
      .then((ok) => {
        if (!ok) return;
        api.fsOperation("delete", paths).then(() => window.dispatchEvent(new CustomEvent("ff-refresh")));
      });
  };

  if (viewMode === "grid" || viewMode === "details") {
    // —— 自适应宫格（F-02：方形网格、窗口自适应）/ 详情列 ——
    return (
      <div
        ref={containerRef}
        style={{ height: "100%", overflowY: "auto", padding: compact ? "8px" : viewMode === "details" ? "0 16px 12px" : "12px 16px" }}
        onClick={(e) => { if (e.target === e.currentTarget) setSelection([]); }}
      >
        {viewMode === "details" ? (
          (() => {
            // 详情列：表头与数据行共用同一 Grid 列模板，保证逐列对齐
            const cols = "minmax(160px, 1fr) 150px 90px minmax(120px, 1fr)";
            const cellBase: React.CSSProperties = { fontSize: 12, color: "var(--ff-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
            return (
              <>
                <div
                  style={{
                    display: "grid", gridTemplateColumns: cols, gap: 12, alignItems: "center",
                    padding: "6px 14px", fontSize: 12, color: "var(--ff-text-secondary)",
                    position: "sticky", top: 0, zIndex: 1,
                    background: "var(--ff-bg-content)", borderBottom: "1px solid var(--ff-border)",
                  }}
                >
                  <span>名称</span>
                  <span style={cellBase}>修改日期</span>
                  <span style={{ ...cellBase, textAlign: "right" }}>大小</span>
                  <span style={cellBase}>标签</span>
                </div>
                {entries.map((e, i) => {
                  const selected = selection.includes(e.path);
                  return (
                    <div
                      key={e.path}
                      onClick={(ev) => select(e, i, ev.ctrlKey || ev.metaKey, ev.shiftKey)}
                      onDoubleClick={() => onOpen(e)}
                      onContextMenu={(ev) => open(ev, entryMenu(e))}
                      data-file-row
                      data-path={e.path}
                      draggable
                      onDragStart={(ev) => {
                        ev.dataTransfer.setData("text/filefly-path", e.path);
                        ev.dataTransfer.setData("text/filefly-paths", JSON.stringify(dragPaths(e)));
                        ev.dataTransfer.effectAllowed = "copyMove";
                      }}
                      {...dropProps(e)}
                      className={cutPaths.includes(e.path) ? "cut-pending" : ""}
                      style={{
                        display: "grid", gridTemplateColumns: cols, gap: 12, alignItems: "center",
                        padding: "5px 14px", fontSize: 13, cursor: "default", borderRadius: 6,
                        background: selected ? "var(--ff-bg-selected)" : "transparent",
                      }}
                      onMouseEnter={(ev) => { if (!selected) ev.currentTarget.style.background = "var(--ff-bg-hover)"; }}
                      onMouseLeave={(ev) => { ev.currentTarget.style.background = selected ? "var(--ff-bg-selected)" : "transparent"; }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span style={{ width: 22, display: "inline-flex", flexShrink: 0 }}>{fileIcon(e, 18)}</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
                        {e.placeholderState !== "none" && (
                          <span style={{ fontSize: 10, color: "var(--ff-accent)", border: "1px solid var(--ff-accent)", borderRadius: 4, padding: "0 4px", flexShrink: 0 }}>
                            {e.placeholderState === "online_only" ? "云" : "部分"}
                          </span>
                        )}
                      </span>
                      <span style={cellBase}>{fmtDate(e.mtime)}</span>
                      <span style={{ ...cellBase, textAlign: "right" }}>{e.isDir ? dirSizeOf(e.path) ?? "—" : fmtSize(e.size)}</span>
                      <span style={{ display: "flex", gap: 4, overflow: "hidden" }}>{e.tags.map((t) => <TagChip key={t} name={t} size={10} />)}</span>
                    </div>
                  );
                })}
              </>
            );
          })()
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 100 : 120}px, 1fr))`, gap: 10 }}>
            {entries.map((e, i) => {
              const selected = selection.includes(e.path);
              return (
                <div
                  key={e.path}
                  onClick={(ev) => select(e, i, ev.ctrlKey || ev.metaKey, ev.shiftKey)}
                  onDoubleClick={() => onOpen(e)}
                  onContextMenu={(ev) => { select(e, i, false, false); open(ev, entryMenu(e)); }}
                  data-file-row
                  data-path={e.path}
                  draggable
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData("text/filefly-path", e.path);
                    ev.dataTransfer.setData("text/filefly-paths", JSON.stringify(dragPaths(e)));
                    ev.dataTransfer.effectAllowed = "copyMove";
                  }}
                  {...dropProps(e)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: 10,
                    borderRadius: 8, cursor: "default",
                    background: selected ? "var(--ff-bg-selected)" : "transparent",
                    opacity: cutPaths.includes(e.path) ? 0.45 : 1,
                  }}
                  onMouseEnter={(ev) => { if (!selected) ev.currentTarget.style.background = "var(--ff-bg-hover)"; }}
                  onMouseLeave={(ev) => { if (!selected) ev.currentTarget.style.background = "transparent"; }}
                >
                  <Thumb entry={e} size={compact ? 64 : 88} />
                  <div style={{ fontSize: 12, textAlign: "center", wordBreak: "break-all", lineHeight: 1.3, maxHeight: 32, overflow: "hidden" }}>{e.name}</div>
                  {e.tags.length > 0 && <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "center" }}>{e.tags.map((t) => <TagChip key={t} name={t} size={10} />)}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // —— 列表视图（虚拟化，10万+ 行 60fps）——
  const rows = virtualizer.getVirtualItems();
  return (
    <div
      ref={containerRef}
      style={{ height: "100%", overflowY: "auto", paddingBottom: 10 }}
      onClick={(e) => { if (e.target === e.currentTarget) setSelection([]); }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {rows.map((row) => {
          const e = entries[row.index];
          return (
            <FileRow
              key={e.path}
              entry={e}
              idx={row.index}
              selected={selection.includes(e.path)}
              cut={cutPaths.includes(e.path)}
              style={{ position: "absolute", top: row.start, left: 0, width: "100%", height: row.size }}
              onSelect={select}
              onOpen={onOpen}
              onMenu={(ev) => open(ev, entryMenu(e))}
              dragPathsOf={dragPaths}
              dropPropsOf={dropProps}
              dirSizeOf={dirSizeOf}
            />
          );
        })}
      </div>
    </div>
  );
};

const FileRow: React.FC<{
  entry: EntryMeta;
  idx: number;
  selected: boolean;
  cut: boolean;
  style?: React.CSSProperties;
  onSelect: (e: EntryMeta, idx: number, multi: boolean, range: boolean) => void;
  onOpen: (e: EntryMeta) => void;
  onMenu: (ev: React.MouseEvent) => void;
  dragPathsOf: (e: EntryMeta) => string[];
  dropPropsOf: (e: EntryMeta) => Record<string, unknown>;
  dirSizeOf: (path: string) => string | undefined;
}> = ({ entry, idx, selected, cut, style, onSelect, onOpen, onMenu, dragPathsOf, dropPropsOf, dirSizeOf }) => {
  const compact = style !== undefined; // 虚拟化模式即紧凑列表
  const rowStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8, padding: compact ? "0 14px" : "6px 14px",
    fontSize: 13, cursor: "default",
    background: selected ? "var(--ff-bg-selected)" : undefined,
    borderRadius: 6,
    ...style,
  };
  return (
    <div
      style={rowStyle}
      onClick={(ev) => onSelect(entry, idx, ev.ctrlKey || ev.metaKey, ev.shiftKey)}
      onDoubleClick={() => onOpen(entry)}
      onContextMenu={onMenu}
      data-file-row
      data-path={entry.path}
      onMouseEnter={(ev) => { if (!selected) ev.currentTarget.style.background = "var(--ff-bg-hover)"; }}
      onMouseLeave={(ev) => { if (!selected) ev.currentTarget.style.background = selected ? "var(--ff-bg-selected)" : "transparent"; }}
      className={cut ? "cut-pending" : ""}
      draggable
      onDragStart={(ev) => {
        // 携带选区路径（拖拽移动/打标共用）
        ev.dataTransfer.setData("text/filefly-path", entry.path);
        ev.dataTransfer.setData("text/filefly-paths", JSON.stringify(dragPathsOf(entry)));
        ev.dataTransfer.effectAllowed = "copyMove";
      }}
      {...dropPropsOf(entry)}
    >
      <span style={{ width: 22, display: "inline-flex", flexShrink: 0 }}>{fileIcon(entry, 18)}</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
      {entry.placeholderState !== "none" && (
        <span style={{ fontSize: 10, color: "var(--ff-accent)", border: "1px solid var(--ff-accent)", borderRadius: 4, padding: "0 4px" }}>
          {entry.placeholderState === "online_only" ? "云" : "部分"}
        </span>
      )}
      <span style={{ display: "flex", gap: 4 }}>{entry.tags.map((t) => <TagChip key={t} name={t} size={10} />)}</span>
      {!compact && (
        <>
          <span style={{ width: 120, color: "var(--ff-text-secondary)", fontSize: 12, textAlign: "right" }}>{fmtDate(entry.mtime)}</span>
          <span style={{ width: 80, color: "var(--ff-text-secondary)", fontSize: 12, textAlign: "right" }}>{entry.isDir ? dirSizeOf(entry.path) ?? "—" : fmtSize(entry.size)}</span>
        </>
      )}
    </div>
  );
};
