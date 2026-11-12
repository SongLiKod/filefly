// 侧边栏（F-07：收藏、标签、保险箱、回收站、网络位置 + F-21 标签聚合入口）
import React, { useEffect, useState } from "react";
import { useTags } from "@/features/tags/tagStore";
import { useTabs } from "@/features/tabs/tabsStore";
import { useApp } from "@/features/settings/appStore";
import { api } from "@/ipc/client";
import { Icons } from "@/components/Icons";
import { TagChip, useContextMenu, type MenuItem } from "@/components/ui";
import { alertDialog, confirmDialog, promptDialog } from "@/components/dialog";
import { fmtSize } from "@/ipc/types";

// 兜底占位：应用启动后由 fs_special_dirs 回填真实用户目录（appStore.specialDirs）
const FALLBACK_FAVORITES = [
  { name: "桌面", path: "C:\\Users\\demo\\Desktop" },
  { name: "文档", path: "C:\\Users\\demo\\Documents" },
  { name: "图片", path: "C:\\Users\\demo\\Pictures" },
  { name: "音乐", path: "C:\\Users\\demo\\Music" },
  { name: "视频", path: "C:\\Users\\demo\\Videos" },
  { name: "下载", path: "C:\\Users\\demo\\Downloads" },
];

// 预设 8 色标签色板（主题 §8.5）
const TAG_COLOR_PRESETS: [string, string][] = [
  ["红", "#E5484D"], ["橙", "#F76B15"], ["黄", "#FFC53D"], ["绿", "#46A758"],
  ["青", "#00B8C4"], ["蓝", "#2E6BE6"], ["紫", "#8E4EC6"], ["灰", "#8B8D98"],
];

// 收藏区专用图标：每个用户目录独立造型 + 主题色（避免千篇一律的文件夹）
const FAV_ICONS: Record<string, React.FC<{ size?: number; color?: string }>> = {
  "桌面": Icons.DesktopDir,
  "文档": Icons.DocumentsDir,
  "图片": Icons.PicturesDir,
  "音乐": Icons.MusicDir,
  "视频": Icons.VideosDir,
  "下载": Icons.DownloadsDir,
};
const FAV_ICON_COLORS: Record<string, string> = {
  "桌面": "#2E6BE6",
  "文档": "#46A758",
  "图片": "#00B8C4",
  "音乐": "#8E4EC6",
  "视频": "#E5484D",
  "下载": "#F76B15",
};

export const Sidebar: React.FC = () => {
  const { defs, load, createTag, renameTag, deleteTag, setTagColor } = useTags();
  const navigate = useTabs((s) => s.navigate);
  const toggleOpen = useApp((s) => s.toggleOpen);
  const specialDirs = useApp((s) => s.specialDirs);
  const sidebarCollapsed = useApp((s) => s.sidebarCollapsed);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  const { open: openCtx } = useContextMenu();
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({});
  const [drives, setDrives] = useState<{ name: string; path: string; total: number; free: number; fs: string }[]>([]);

  useEffect(() => {
    load();
    api.fsDrives().then(setDrives).catch(() => {});
    useApp.getState().loadSpecialDirs();
  }, [load]);

  // 真实用户目录（桌面/文档/图片/音乐/视频/下载，来自 SHGetKnownFolderPath）
  const favorites = specialDirs
    ? [
        { name: "桌面", path: specialDirs.desktop },
        { name: "文档", path: specialDirs.documents },
        { name: "图片", path: specialDirs.pictures },
        { name: "音乐", path: specialDirs.music },
        { name: "视频", path: specialDirs.videos },
        { name: "下载", path: specialDirs.downloads },
      ].filter((f) => f.path)
    : FALLBACK_FAVORITES;

  useEffect(() => {
    // 标签聚合计数
    (async () => {
      const counts: Record<string, number> = {};
      for (const d of defs) {
        const files = await api.tagFilesOf(d.name);
        counts[d.name] = files.length;
      }
      setTagCounts(counts);
    })();
  }, [defs]);

  const Sec: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", fontSize: 11, color: "var(--ff-text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {icon}{title}
      </div>
      {children}
    </div>
  );

  const Item: React.FC<{ label: string; icon?: React.ReactNode; onClick: () => void; active?: boolean; extra?: React.ReactNode; onDropFile?: (path: string) => void; onContextMenu?: (e: React.MouseEvent) => void }> = ({ label, icon, onClick, active, extra, onDropFile, onContextMenu }) => (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragOver={onDropFile ? (e) => { e.preventDefault(); e.currentTarget.classList.add("drop-target"); } : undefined}
      onDragLeave={onDropFile ? (e) => e.currentTarget.classList.remove("drop-target") : undefined}
      onDrop={onDropFile ? async (e) => {
        e.preventDefault();
        e.currentTarget.classList.remove("drop-target");
        const p = e.dataTransfer.getData("text/filefly-path");
        if (p) await onDropFile(p);
      } : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", margin: "0 6px",
        borderRadius: 6, fontSize: 13, cursor: "pointer",
        color: active ? "var(--ff-primary)" : "var(--ff-text-primary)",
        fontWeight: active ? 600 : 400,
        background: active ? "var(--ff-bg-selected)" : "transparent",
        boxShadow: active ? "inset 2.5px 0 0 var(--ff-primary)" : "none",
        transition: "background 130ms, color 130ms",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--ff-bg-hover)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      {icon}
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {extra}
    </div>
  );

  // 当前激活路径（用于侧栏高亮）
  const activePath = useTabs((s) => s.tabs.find((t) => t.id === s.activeTabId)?.path);

  // 折叠态：44px 图标窄条，保留常用入口（Ctrl+B / 顶部按钮切换）
  if (sidebarCollapsed) {
    const RailBtn: React.FC<{ title: string; icon: React.ReactNode; onClick: () => void }> = ({ title, icon, onClick }) => (
      <div
        title={title}
        onClick={onClick}
        style={{
          width: 30, height: 30, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", color: "var(--ff-text-secondary)", flexShrink: 0,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ff-bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        {icon}
      </div>
    );
    return (
      <div
        className="glass"
        style={{
          width: 44, minWidth: 44, height: "100%", background: "var(--ff-bg-sidebar)",
          borderRight: "1px solid var(--ff-border)", display: "flex", flexDirection: "column",
          alignItems: "center", paddingTop: 10, paddingBottom: 12, gap: 4,
        }}
      >
        <RailBtn title="展开侧栏 (Ctrl+B)" icon={<Icons.Forward size={14} />} onClick={toggleSidebar} />
        <div style={{ width: 22, height: 1, background: "var(--ff-border)", margin: "4px 0" }} />
        <RailBtn title="首页" icon={<Icons.Home size={16} />} onClick={() => navigate("__home__", "首页")} />
        <RailBtn title="最近使用" icon={<Icons.Clock size={16} />} onClick={() => navigate("__recent__", "最近使用")} />
        <div style={{ width: 22, height: 1, background: "var(--ff-border)", margin: "4px 0" }} />
        <RailBtn title="保险箱" icon={<Icons.Lock size={16} />} onClick={() => navigate("__vault__", "保险箱")} />
        <RailBtn title="回收站" icon={<Icons.Trash size={16} />} onClick={() => navigate("__trash__", "回收站")} />
        <RailBtn title="网络位置" icon={<Icons.Network size={16} />} onClick={() => navigate("__network__", "网络位置")} />
        <RailBtn title="重复文件" icon={<Icons.Duplicate size={16} />} onClick={() => toggleOpen("duplicatesOpen")} />
      </div>
    );
  }

  return (
    <div
      className="glass"
      style={{
        width: 220, minWidth: 220, height: "100%", overflowY: "auto",
        background: "var(--ff-bg-sidebar)", borderRight: "1px solid var(--ff-border)",
        paddingTop: 10, paddingBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px 4px" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ff-text-secondary)", letterSpacing: 0.5 }}>FileFly</span>
        <div
          title="折叠侧栏 (Ctrl+B)"
          onClick={toggleSidebar}
          style={{
            width: 24, height: 24, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: "var(--ff-text-secondary)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ff-bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Icons.Back size={14} />
        </div>
      </div>
      <Item label="首页" icon={<Icons.Home />} active={activePath === "__home__"} onClick={() => navigate("__home__", "首页")} />
      <Item label="最近使用" icon={<Icons.Clock />} active={activePath === "__recent__"} onClick={() => navigate("__recent__", "最近使用")} />

      <Sec title="收藏" icon={<Icons.Star size={12} />}>
        {favorites.map((f) => {
          const FIcon = FAV_ICONS[f.name];
          return (
            <Item
              key={f.path}
              label={f.name}
              icon={FIcon
                ? <FIcon size={15} color={FAV_ICON_COLORS[f.name]} />
                : <Icons.Folder size={15} color="var(--ff-accent)" />}
              active={activePath === f.path}
              onClick={() => navigate(f.path, f.name)}
            />
          );
        })}
      </Sec>

      <Sec title="标签" icon={<Icons.Tag size={12} />}>
        {defs.map((d) => (
          <Item
            key={d.name}
            label={d.name}
            icon={<span style={{ width: 10, height: 10, borderRadius: 5, background: d.color, display: "inline-block" }} />}
            active={activePath === `__tag__:${d.name}`}
            onClick={() => navigate(`__tag__:${d.name}`, `标签：${d.name}`)}
            onContextMenu={(e) => {
              e.preventDefault();
              const menu: MenuItem[] = [
                {
                  label: "改颜色",
                  submenu: TAG_COLOR_PRESETS.map(([label, color]) => ({
                    label,
                    icon: <span style={{ width: 12, height: 12, borderRadius: 6, background: color, display: "inline-block", outline: d.color === color ? "2px solid var(--ff-accent)" : "none", outlineOffset: 1 }} />,
                    onClick: () => { setTagColor(d.name, color).catch((err) => alert(`修改颜色失败：${err}`)); },
                  })),
                },
                {
                  label: "重命名",
                  onClick: async () => {
                    const name = await promptDialog("重命名标签", { message: "将从所有文件中同步更新。", value: d.name, confirmText: "重命名" });
                    if (name === null) return;
                    const nn = name.trim();
                    if (!nn || nn === d.name) return;
                    try { await renameTag(d.name, nn); } catch (err) { await alertDialog("重命名失败", String(err), "error"); }
                  },
                },
                { separator: true },
                {
                  label: "删除标签",
                  onClick: async () => {
                    const n = tagCounts[d.name] ?? 0;
                    const ok = await confirmDialog("删除标签", n > 0 ? `将从 ${n} 个文件中移除该标签，且无法恢复。确定删除「${d.name}」？` : `确定删除标签「${d.name}」？`, { danger: true, confirmText: "删除" });
                    if (!ok) return;
                    try { await deleteTag(d.name); } catch (err) { await alertDialog("删除失败", String(err), "error"); }
                  },
                },
              ];
              openCtx(e, menu);
            }}
            onDropFile={async (p) => {
              // 拖文件至侧栏标签 = 打标（技术文档 §9 标签规格）
              await api.tagAdd(p, d.name);
              window.dispatchEvent(new CustomEvent("ff-refresh"));
            }}
            extra={<span style={{ fontSize: 11, color: "var(--ff-text-disabled)" }}>{tagCounts[d.name] ?? 0}</span>}
          />
        ))}
        <Item
          label="新建标签"
          icon={<span style={{ fontSize: 14, lineHeight: 1, color: "var(--ff-accent)", fontWeight: 600 }}>＋</span>}
          onClick={async () => {
            const name = await promptDialog("新建标签", { message: "输入新标签名称，创建后可在标签右键菜单中改颜色或重命名。", placeholder: "例如：工作、发票…" });
            if (!name || !name.trim()) return;
            const color = TAG_COLOR_PRESETS[defs.length % TAG_COLOR_PRESETS.length][1];
            try {
              await createTag(name.trim(), color);
            } catch (err) {
              await alertDialog("新建标签失败", String(err), "error");
            }
          }}
        />
      </Sec>

      <Sec title="位置" icon={<Icons.Disk size={12} />}>
        {drives.map((d) => (
          <Item
            key={d.path}
            label={d.name}
            icon={<Icons.Disk size={15} />}
            active={activePath === d.path}
            onClick={() => navigate(d.path, d.name)}
            extra={<span style={{ fontSize: 10, color: "var(--ff-text-disabled)" }}>{d.fs}</span>}
          />
        ))}
      </Sec>

      <Sec title="其他" icon={<Icons.Network size={12} />}>
        <Item label="保险箱" icon={<Icons.Lock />} active={activePath === "__vault__"} onClick={() => navigate("__vault__", "保险箱")} />
        <Item label="回收站" icon={<Icons.Trash />} active={activePath === "__trash__"} onClick={() => navigate("__trash__", "回收站")} />
        <Item label="网络位置" icon={<Icons.Network />} active={activePath === "__network__"} onClick={() => navigate("__network__", "网络位置")} />
        <Item label="重复文件" icon={<Icons.Duplicate />} onClick={() => toggleOpen("duplicatesOpen")} />
      </Sec>
    </div>
  );
};
