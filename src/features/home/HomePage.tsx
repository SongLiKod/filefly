// 智能首页（F-06：最近使用 / 收藏夹 / 分类聚合 / 磁盘容量 / 云盘入口）
import React, { useEffect, useState } from "react";
import { api } from "@/ipc/client";
import type { DriveInfo, HomeStats } from "@/ipc/types";
import { fmtDate, fmtSize } from "@/ipc/types";
import { useTabs, HOME_PATH } from "@/features/tabs/tabsStore";
import { useApp } from "@/features/settings/appStore";
import { Icons } from "@/components/Icons";
import { DiskBar, LoadingHint, SkeletonRows, Spinner } from "@/components/ui";

// 分类色（主题 §8.4）
const CATEGORY = {
  document: { label: "文档", icon: <Icons.File size={22} />, color: "#2E6BE6", light: "#EDF3FE" },
  image: { label: "图片", icon: <Icons.Image size={22} />, color: "#16A34A", light: "#EAF7EF" },
  music: { label: "音乐", icon: <Icons.Music size={22} />, color: "#D946EF", light: "#FBEFFC" },
  video: { label: "视频", icon: <Icons.Video size={22} />, color: "#7C3AED", light: "#F3EEFC" },
  archive: { label: "压缩包", icon: <Icons.Archive size={22} />, color: "#D97706", light: "#FDF4E7" },
  installer: { label: "安装包", icon: <Icons.Installer size={22} />, color: "#EA580C", light: "#FDF0E9" },
} as const;

export const HomePage: React.FC = () => {
  const navigate = useTabs((s) => s.navigate);
  const specialDirs = useApp((s) => s.specialDirs);
  // 真实用户目录（appStore 启动时由 fs_special_dirs 加载；兜底 tabsStore 动态主目录）
  const home = specialDirs?.home || HOME_PATH;
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [recent, setRecent] = useState<[string, string, number][]>([]);
  const [recentLoaded, setRecentLoaded] = useState(false);
  const [cloud, setCloud] = useState<{ name: string; icon: string; path: string }[]>([]);
  const [indexReady, setIndexReady] = useState<boolean | null>(null); // null=查询中

  useEffect(() => {
    if (!home || home.includes("\\demo")) return; // 占位路径不统计，等真实目录就绪
    const fetchStats = () => api.fsHomeStats(home).then(setStats).catch(() => {});
    fetchStats();
    api.fsDrives().then(setDrives).catch(() => {});
    api.fsRecent().then((r) => { setRecent(r); setRecentLoaded(true); }).catch(() => setRecentLoaded(true));
    // 云盘入口：基于真实主目录探测 OneDrive / iCloudDrive（存在才显示）
    api.fsList(home)
      .then(({ entries }) => {
        const found: { name: string; icon: string; path: string }[] = [];
        for (const e of entries) {
          if (!e.isDir) continue;
          const n = e.name.toLowerCase();
          if (n === "onedrive") found.push({ name: "OneDrive", icon: "☁️", path: e.path });
          else if (n.includes("icloud")) found.push({ name: "iCloud", icon: "🍎", path: e.path });
        }
        setCloud(found);
      })
      .catch(() => {});
    // 索引就绪后自动刷新统计（修复：打开首页时索引未建好导致一直显示 0）
    const timer = setInterval(async () => {
      try {
        const st = await api.searchStatus();
        setIndexReady(!!st?.ready);
        if (st?.ready) {
          clearInterval(timer);
          fetchStats();
        }
      } catch { clearInterval(timer); setIndexReady(null); }
    }, 2500);
    return () => clearInterval(timer);
  }, [home]);

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "24px 32px", background: "var(--ff-bg-app)" }}>
      <h1 style={{ margin: "0 0 6px", fontSize: 22, display: "flex", alignItems: "center", gap: 10 }}>
        <Icons.Logo size={28} /> <span className="gradient-text">首页</span>
      </h1>
      <p style={{ margin: "0 0 24px", color: "var(--ff-text-secondary)", fontSize: 13 }}>Let your files fly · 让文件飞</p>

      {/* 分类聚合（浅色底 + 深色图标，主题 §8.4） */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12, marginBottom: 28 }}>
        {Object.entries(CATEGORY).map(([key, c]) => (
          <div
            key={key}
            onClick={() => navigate("__category__:" + key, c.label)}
            style={{
              display: "flex", alignItems: "center", gap: 12, padding: 16, borderRadius: 12, cursor: "pointer",
              background: c.light, border: "1px solid var(--ff-border)",
              transition: "transform 150ms",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(23,26,33,.08)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
          >
            <span style={{ color: c.color }}>{c.icon}</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{c.label}</div>
              <div style={{ fontSize: 12, color: "var(--ff-text-secondary)", display: "flex", alignItems: "center", gap: 5, minHeight: 16 }}>
                {stats === null ? (<><span style={{ width: 7, height: 7, borderRadius: "50%", border: "1.5px solid var(--ff-border)", borderTopColor: "var(--ff-primary)", display: "inline-block" }} className="spin" />统计中…</>) : <>{stats.counts?.[key] ?? 0} 个文件</>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* 磁盘容量可视化（§8.6 用量条三段色） */}
        <section>
          <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>磁盘</h3>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14, padding: 16 }}>
            {drives.map((d) => (
              <div key={d.path} onClick={() => navigate(d.path, d.name)} style={{ cursor: "pointer" }}>
                <DiskBar total={d.total} free={d.free} label={`${d.name} · 可用 ${fmtSize(d.free)} / ${fmtSize(d.total)}`} />
              </div>
            ))}
            {drives.length === 0 && <span style={{ color: "var(--ff-text-secondary)", fontSize: 13 }}>加载中…</span>}
          </div>

          {cloud.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, margin: "20px 0 10px" }}>云盘</h3>
              <div style={{ display: "flex", gap: 12 }}>
                {cloud.map((c) => (
                  <div key={c.path} onClick={() => navigate(c.path, c.name)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, background: "var(--ff-bg-card)", border: "1px solid var(--ff-border)", cursor: "pointer", fontSize: 13 }}>
                    <span>{c.icon}</span>{c.name}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* 最近使用（F-22） */}
        <section>
          <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>最近使用</h3>
          <div className="card" style={{ padding: 8 }}>
            {!recentLoaded ? (
              <SkeletonRows rows={5} padding={10} />
            ) : (
              <>
            {recent.length === 0 && (stats?.recentFiles?.length ?? 0) === 0 && (
              <div style={{ color: "var(--ff-text-secondary)", fontSize: 13, padding: 10 }}>暂无记录</div>
            )}
            {(recent.length > 0
              ? recent.map(([path, , t]) => ({ path, mtime: t * 1000 }))
              : (stats?.recentFiles ?? []).map((f) => ({ path: f.path, mtime: f.mtime }))
            ).slice(0, 10).map((r) => {
              const name = r.path.split(/[\\/]/).pop() ?? r.path;
              const parent = r.path.split(/[\\/]/).slice(0, -1).join("\\");
              return (
                <div key={r.path} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, fontSize: 13, cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ff-bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  onClick={() => navigate(parent, parent.split(/[\\/]/).pop() ?? parent)}
                >
                  <Icons.File size={15} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                  <span style={{ fontSize: 11, color: "var(--ff-text-disabled)" }}>{fmtDate(r.mtime)}</span>
                </div>
              );
            })}
              </>
            )}
          </div>
        </section>
      </div>

      {/* 索引建设提示：统计数据依赖索引，未就绪时明示（而不是让用户以为数据就是 0） */}
      {indexReady === false && (
        <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 10, background: "var(--ff-bg-card)", border: "1px dashed var(--ff-border)", color: "var(--ff-text-secondary)", fontSize: 12 }}>
          <Spinner size={13} /> 正在后台建立文件索引，分类统计与搜索将在就绪后自动更新…
        </div>
      )}
    </div>
  );
};
