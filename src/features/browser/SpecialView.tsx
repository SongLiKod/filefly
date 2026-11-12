// 特殊视图：标签聚合（F-21）/ 最近使用（F-22）/ 分类聚合 / 回收站（真实 $Recycle.Bin）/ 网络位置
import React, { useEffect, useState } from "react";
import { api } from "@/ipc/client";
import type { EntryMeta, SearchHit, TrashItem, DriveInfo } from "@/ipc/types";
import { fmtDate, fmtSize } from "@/ipc/types";
import { FileList } from "@/features/browser/FileList";
import { openEntrySmart } from "@/utils/openEntry";
import { useTabs } from "@/features/tabs/tabsStore";
import { useApp } from "@/features/settings/appStore";
import { Icons } from "@/components/Icons";
import { TagChip, LoadingHint, SkeletonRows } from "@/components/ui";
import { alertDialog, confirmDialog } from "@/components/dialog";

const CATEGORY_LABELS: Record<string, string> = {
  document: "文档", image: "图片", music: "音乐", video: "视频", archive: "压缩包", installer: "安装包",
};

export const SpecialView: React.FC<{ path: string }> = ({ path }) => {
  const navigate = useTabs((s) => s.navigate);
  const [entries, setEntries] = useState<EntryMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [trash, setTrash] = useState<TrashItem[] | null>(null);
  const [netDrives, setNetDrives] = useState<DriveInfo[] | null>(null);
  const [trashLimit, setTrashLimit] = useState(300);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setTrash(null);
    setNetDrives(null);
    setLoadErr(null);
    setTrashLimit(300);
    setHint(null);
    // 看门狗：30s 未返回显式报错，绝不无限停留在骨架屏
    const watchdog = setTimeout(() => {
      if (alive) { setLoading(false); setLoadErr("加载超时（30 秒），可点击重试"); }
    }, 30000);
    (async () => {
      try {
        if (path === "__trash__") {
          setTitle("回收站");
          const items = await api.fsTrashList();
          if (!alive) return;
          setTrash(items);
        } else if (path === "__network__") {
          setTitle("网络位置");
          const drives = await api.fsNetworkDrives();
          if (!alive) return;
          setNetDrives(drives);
        } else if (path.startsWith("__tag__:")) {
          const tag = path.slice(8);
          setTitle(`标签：${tag}`);
          const files = await api.tagFilesOf(tag);
          if (!alive) return;
          setEntries(
            files.map(([p, tags]) => ({
              name: p.split(/[\\/]/).pop() ?? p, path: p, isDir: false,
              size: 0, mtime: 0, ext: p.split(".").pop()?.toLowerCase() ?? null,
              hidden: false, placeholderState: "none", tags,
            }))
          );
        } else if (path === "__recent__") {
          setTitle("最近使用");
          const rows = await api.fsRecent();
          if (!alive) return;
          let list = rows.map(([p, kind, t]) => ({
            name: p.split(/[\\/]/).pop() ?? p, path: p, isDir: kind === "location",
            size: 0, mtime: t * 1000, ext: p.split(".").pop()?.toLowerCase() ?? null,
            hidden: false, placeholderState: "none" as const, tags: [] as string[],
          }));
          if (list.length === 0) {
            // 兜底：真实打开记录尚空（新版首次使用）→ 回退"最近修改的文件"（与首页统计同源），避免空白页
            const home = useApp.getState().specialDirs?.home ?? "";
            const stats = await api.fsHomeStats(home);
            if (!alive) return;
            list = (stats.recentFiles ?? []).map((f) => ({
              name: f.path.split(/[\\/]/).pop() ?? f.path, path: f.path, isDir: false,
              size: 0, mtime: f.mtime > 0 && f.mtime < 10_000_000_000 ? f.mtime * 1000 : f.mtime,
              ext: f.path.split(".").pop()?.toLowerCase() ?? null,
              hidden: false, placeholderState: "none" as const, tags: [] as string[],
            }));
            if (alive && list.length > 0) setHint("以下为最近修改的文件 · 双击打开后，这里会积累你自己的打开记录");
          }
          setEntries(list);
        } else if (path.startsWith("__category__:")) {
          const key = path.slice("__category__:".length); // 前缀实长 13（此前 slice(12) 多留冒号 → 后端报"未知分类：:image"）
          setTitle(CATEGORY_LABELS[key] ?? key);
          // 专用分类命令：索引可用走索引（ext 不区分大小写），否则真实文件系统扫描——与首页统计同源
          const home = useApp.getState().specialDirs?.home ?? "";
          const hits = await api.fsCategoryFiles(key, home);
          if (!alive) return;
          setEntries(hits.map(toEntry));
        }
      } catch (e) {
        // 不再静默吞错：加载失败时给出可见错误（否则整页空白无从排查）
        if (alive) setLoadErr(String(e));
      } finally {
        if (alive) { clearTimeout(watchdog); setLoading(false); }
      }
    })();
    return () => { alive = false; clearTimeout(watchdog); };
  }, [path, reload]);

  const open = (e: EntryMeta) => {
    void openEntrySmart(e.path, e.isDir, () => navigate(e.path));
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--ff-bg-content)" }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--ff-border)", display: "flex", alignItems: "center", gap: 8 }}>
        <Icons.Tag />
        <strong style={{ fontSize: 16 }}>{title || "…"}</strong>
        <span style={{ color: "var(--ff-text-secondary)", fontSize: 12 }}>跨路径聚合 · {entries.length} 项</span>
        {path === "__recent__" && !loading && !hint && entries.length > 0 && (
          <button
            className="btn-ghost"
            style={{ marginLeft: "auto", fontSize: 12 }}
            onClick={async () => {
              const ok = await confirmDialog("清空最近使用", `确定清空全部 ${entries.length} 条打开记录吗？此操作不影响文件本身。`, { danger: true, confirmText: "清空" });
              if (!ok) return;
              await api.fsRecentClear();
              setReload((n) => n + 1);
            }}
          >
            <Icons.Trash size={13} /> 清空记录
          </button>
        )}
      </div>
      {hint && (
        <div style={{ padding: "6px 20px", fontSize: 12, color: "var(--ff-text-secondary)", background: "var(--ff-bg-card)", borderBottom: "1px solid var(--ff-border)" }}>
          ⓘ {hint}
        </div>
      )}
      {path === "__trash__" && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 20px" }}>
          {trash && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: "var(--ff-text-secondary)" }}>共 {trash.length} 项 · 来自系统回收站（$Recycle.Bin 真实解析）</span>
                <button className="btn-ghost" title="重新扫描所有磁盘的回收站" onClick={() => setReload((n) => n + 1)}>
                  <span style={{ fontSize: 12 }}>↻ 重新扫描</span>
                </button>
                {trash.length > 0 && (
                  <button
                    className="btn-ghost"
                    onClick={async () => {
                      const ok = await confirmDialog("清空回收站", `确定清空回收站全部 ${trash.length} 项吗？此操作不可恢复！`, { danger: true, confirmText: "清空" });
                      if (!ok) return;
                      await api.fsTrashEmpty();
                      setTrash([]);
                    }}
                    style={{ color: "#E5484D" }}
                  >
                    <Icons.Trash size={13} /> 清空回收站
                  </button>
                )}
              </div>
              {trash.length === 0 && (
                <div style={{ padding: 40, textAlign: "center", color: "var(--ff-text-secondary)", fontSize: 13 }}>回收站是空的。</div>
              )}
              {trash.slice(0, trashLimit).map((t) => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, fontSize: 13, borderBottom: "1px solid var(--ff-border)" }}>
                  <Icons.File size={16} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.origName}</div>
                    <div style={{ fontSize: 11, color: "var(--ff-text-disabled)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>原位置：{t.origPath}</div>
                  </div>
                  <span style={{ width: 80, textAlign: "right", fontSize: 12, color: "var(--ff-text-secondary)" }}>{fmtSize(t.size)}</span>
                  <span style={{ width: 120, textAlign: "right", fontSize: 12, color: "var(--ff-text-disabled)" }}>{fmtDate(t.deletedAt)}</span>
                  <button className="btn-ghost" title="恢复到原位置" onClick={async () => {
                    try {
                      const dest = await api.fsTrashRestore(t.iPath);
                      await alertDialog("已恢复", `已恢复到：${dest}`, "success");
                      setTrash((prev) => prev!.filter((x) => x.id !== t.id));
                    } catch (e) { await alertDialog("恢复失败", String(e), "error"); }
                  }}>恢复</button>
                  <button className="btn-ghost" title="彻底删除（不可恢复）" style={{ color: "#E5484D" }} onClick={async () => {
                    const ok = await confirmDialog("彻底删除", `彻底删除「${t.origName}」？此操作不可恢复！`, { danger: true, confirmText: "彻底删除" });
                    if (!ok) return;
                    await api.fsTrashDelete(t.id, t.iPath);
                    setTrash((prev) => prev!.filter((x) => x.id !== t.id));
                  }}><Icons.Trash size={13} /></button>
                </div>
              ))}
              {trash.length > trashLimit && (
                <div style={{ padding: 14, textAlign: "center" }}>
                  <button className="btn-ghost" onClick={() => setTrashLimit((n) => n + 500)}>
                    显示更多（已显示 {trashLimit} / {trash.length} 项）
                  </button>
                </div>
              )}
            </>
          )}
          {!trash && !loadErr && (
            <div>
              <LoadingHint text="正在扫描所有磁盘回收站…" />
              <SkeletonRows rows={6} />
            </div>
          )}
          {loadErr && (
            <div style={{ padding: 20, color: "#E5484D", fontSize: 13, background: "rgba(229,72,77,.06)", borderRadius: 8, marginTop: 8 }}>
              回收站加载失败：{loadErr}
            </div>
          )}
        </div>
      )}
      {path === "__network__" && netDrives && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 20px" }}>
          <div style={{ fontSize: 13, color: "var(--ff-text-secondary)", marginBottom: 10 }}>
            已映射的网络驱动器（点击浏览）；也可以在地址栏直接输入 UNC 路径，如 <code>\\\\NAS\\share</code>
          </div>
          {netDrives.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--ff-text-secondary)", fontSize: 13 }}>
              未检测到已映射的网络驱动器。可在 Windows 资源管理器映射网络驱动器后在此浏览。
            </div>
          )}
          {netDrives.map((d) => (
            <div key={d.path} onClick={() => navigate(d.path, d.name)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, fontSize: 13, cursor: "pointer", borderBottom: "1px solid var(--ff-border)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ff-bg-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Icons.Folder size={17} color="var(--ff-accent)" />
              <span style={{ fontWeight: 600 }}>{d.name}</span>
              <span style={{ color: "var(--ff-text-secondary)", fontSize: 12 }}>{d.path}</span>
              {d.total > 0 && <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ff-text-disabled)" }}>可用 {fmtSize(d.free)} / {fmtSize(d.total)}</span>}
            </div>
          ))}
        </div>
      )}
      {!path.startsWith("__trash__") && !path.startsWith("__network__") && (
        <div style={{ flex: 1, minHeight: 0 }}>
          {loading ? (
            <div>
              <LoadingHint text={`正在加载${title || "视图"}…`} />
              <SkeletonRows rows={8} />
            </div>
          ) : loadErr ? (
            // 错误必须可见：此前通用分支不渲染 loadErr，任何加载失败都表现为"空列表"
            <div style={{ padding: 24, textAlign: "center" }}>
              <div style={{ color: "var(--ff-danger)", fontSize: 13, marginBottom: 12, whiteSpace: "pre-wrap" }}>加载失败：{loadErr}</div>
              <button className="btn-primary" onClick={() => setReload((n) => n + 1)}>↻ 重试</button>
            </div>
          ) : entries.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--ff-text-secondary)", fontSize: 13 }}>暂无内容</div>
          ) : (
            <FileList entries={entries} onOpen={open} />
          )}
        </div>
      )}
    </div>
  );
};

function toEntry(h: SearchHit): EntryMeta {
  return {
    name: h.name, path: h.path, isDir: h.isDir, size: h.size, mtime: h.mtime,
    ext: h.ext, hidden: false, placeholderState: "none", tags: [],
  };
}

export { fmtDate, TagChip };
