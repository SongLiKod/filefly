// 空间分析 / 磁盘清理（用户需求：分析磁盘占用 + 一键清理缓存）
// 架构：占用分布（点击钻取）+ Top 大文件 + 预设白名单清理目标
import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, onEvent } from "@/ipc/client";
import type { CleanTarget, DirStat, ScanProgress, ScanResult } from "@/ipc/types";
import { fmtSize } from "@/ipc/types";
import { useApp } from "@/features/settings/appStore";
import { alertDialog, confirmDialog } from "@/components/dialog";
import { Icons } from "@/components/Icons";

interface Level {
  root: string;
  label: string;
  result: ScanResult;
}

export const SpaceView: React.FC = () => {
  const specialDirs = useApp((s) => s.specialDirs);
  const [roots, setRoots] = useState<{ name: string; path: string }[]>([]);
  const [root, setRoot] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [levels, setLevels] = useState<Level[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [targets, setTargets] = useState<CleanTarget[] | null>(null);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [cleaning, setCleaning] = useState(false);
  const scanSeq = useRef(0);

  // 可选分析根：本机磁盘 + 用户主目录
  useEffect(() => {
    api.fsDrives().then((ds) => {
      const list = ds.map((d) => ({ name: `${d.name}（可用 ${fmtSize(d.free)} / 共 ${fmtSize(d.total)}）`, path: d.path }));
      setRoots(list);
      if (list.length > 0) setRoot((r) => r || list[0].path);
    }).catch(() => {});
  }, []);

  // 扫描进度事件
  useEffect(() => onEvent("space:progress", (p) => {
    setProgress(p as ScanProgress);
  }), []);

  const scan = useCallback(async (targetRoot: string, label: string, push: boolean) => {
    if (!targetRoot || scanning) return;
    const seq = ++scanSeq.current;
    setScanning(true);
    setLoadErr(null);
    try {
      const result = await api.fsSpaceScan(targetRoot);
      if (seq !== scanSeq.current) return; // 已发起新扫描，丢弃旧结果
      setLevels((prev) => push ? [...prev, { root: targetRoot, label, result }] : [{ root: targetRoot, label, result }]);
    } catch (e) {
      if (seq === scanSeq.current) setLoadErr(String(e));
    } finally {
      if (seq === scanSeq.current) { setScanning(false); setProgress(null); }
    }
  }, [scanning]);

  const startScan = () => { setLevels([]); void scan(root, root, false); };
  const drill = (d: DirStat) => void scan(d.path, d.name, true);
  const jumpTo = (idx: number) => setLevels((prev) => prev.slice(0, idx + 1));
  const current = levels[levels.length - 1] ?? null;

  const scanTargets = async () => {
    setTargetsLoading(true);
    try {
      const t = await api.fsCleanTargets();
      setTargets(t);
      setChecked(Object.fromEntries(t.filter((x) => x.cleanable).map((x) => [x.id, true])));
    } catch (e) {
      await alertDialog("扫描清理项失败", String(e), "error");
    } finally {
      setTargetsLoading(false);
    }
  };

  const executeClean = async () => {
    const ids = Object.entries(checked).filter(([, v]) => v).map(([k]) => k);
    if (ids.length === 0) return;
    const chosen = (targets ?? []).filter((t) => ids.includes(t.id));
    const lines = chosen.map((t) => `· ${t.name}：${fmtSize(t.size)}${t.partial ? "（估算）" : ""}`).join("\n");
    const ok = await confirmDialog(
      "确认清理",
      `将永久删除以下内容（不经过回收站，不可恢复）：\n${lines}\n\n这些均为缓存/临时文件，不影响系统与个人文档。继续吗？`,
      { danger: true, confirmText: "永久删除" },
    );
    if (!ok) return;
    setCleaning(true);
    try {
      const report = await api.fsCleanExecute(ids);
      const failText = report.failed.length > 0 ? `\n\n以下 ${report.failed.length} 项跳过（通常为占用中的系统文件）：\n${report.failed.slice(0, 8).join("\n")}${report.failed.length > 8 ? "\n…" : ""}` : "";
      await alertDialog("清理完成", `已释放约 ${fmtSize(report.freed)}。${failText}`, report.failed.length > 0 ? "warning" : "success");
      setTargets(null); // 重新扫描得出新大小
      window.dispatchEvent(new CustomEvent("ff-refresh"));
    } catch (e) {
      await alertDialog("清理失败", String(e), "error");
    } finally {
      setCleaning(false);
    }
  };

  const maxSize = current ? Math.max(...current.result.children.map((c) => c.size), 1) : 1;
  const parentSize = current?.result.totalSize ?? 1;

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "14px 20px 24px", background: "var(--ff-bg-content)" }}>
      {/* 标题 + 根选择 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ color: "var(--ff-accent)", display: "inline-flex" }}><Icons.Disk size={17} /></span>
        <strong style={{ fontSize: 16 }}>空间分析</strong>
        <select value={root} disabled={scanning}
          onChange={(e) => { setRoot(e.target.value); setLevels([]); }}
          style={{ background: "var(--ff-bg-card)", color: "var(--ff-text-primary)", border: "1px solid var(--ff-border)", borderRadius: 8, padding: "4px 8px", fontSize: 13, maxWidth: 340 }}
        >
          {roots.map((r) => <option key={r.path} value={r.path}>{r.name}</option>)}
          {specialDirs?.home && <option value={specialDirs.home}>用户目录（{specialDirs.home}）</option>}
        </select>
        {scanning ? (
          <button className="btn-ghost" onClick={() => api.fsSpaceCancel().catch(() => {})}>
            <Icons.Close size={13} /> 取消扫描
          </button>
        ) : (
          <button className="btn-primary" onClick={startScan}>⟳ 开始扫描</button>
        )}
        {current && !scanning && (
          <span style={{ fontSize: 12, color: "var(--ff-text-secondary)", marginLeft: "auto" }}>
            总占用 {fmtSize(current.result.totalSize)} · {current.result.totalFiles.toLocaleString()} 文件 · {current.result.totalDirs.toLocaleString()} 文件夹
            {current.result.cancelled && <span style={{ color: "var(--ff-danger)" }}>（已取消，结果不完整）</span>}
          </span>
        )}
      </div>

      {/* 进度条（不确定总量：动画条纹 + 已扫描条目数） */}
      {scanning && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ height: 6, borderRadius: 3, background: "var(--ff-border)", overflow: "hidden" }}>
            <div className="scan-indeterminate" style={{ height: "100%", width: "30%", background: "var(--ff-primary)", animation: "ff-indeterminate 1.2s ease-in-out infinite" }} />
          </div>
          <div style={{ fontSize: 11, color: "var(--ff-text-disabled)", marginTop: 4 }}>
            已扫描 {progress ? progress.scanned.toLocaleString() : "0"} 项…大目录扫描可能需要数十秒，可随时取消
          </div>
        </div>
      )}

      {loadErr && (
        <div style={{ padding: 16, color: "var(--ff-danger)", fontSize: 13, background: "rgba(229,72,77,.06)", borderRadius: 8, marginBottom: 12 }}>
          扫描失败：{loadErr}
        </div>
      )}

      {/* 面包屑钻取 */}
      {levels.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 8, fontSize: 12 }}>
          {levels.map((lv, i) => (
            <span key={lv.root} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {i > 0 && <span style={{ color: "var(--ff-text-disabled)" }}>›</span>}
              <button className="btn-ghost" style={{ fontSize: 12, padding: "2px 6px" }} onClick={() => jumpTo(i)}>
                {lv.label}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 占用分布列表 */}
      {current && (
        <div style={{ border: "1px solid var(--ff-border)", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
          {current.result.children.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: "var(--ff-text-secondary)", fontSize: 13 }}>此目录为空或无法访问。</div>
          ) : current.result.children.slice(0, 200).map((c) => (
            <div key={c.path}
              onClick={() => c.isDir && drill(c)}
              style={{
                display: "grid", gridTemplateColumns: "minmax(120px, 2fr) 110px minmax(80px, 1fr) 90px 70px",
                gap: 10, alignItems: "center", padding: "7px 14px", fontSize: 13,
                cursor: c.isDir ? "pointer" : "default", borderBottom: "1px solid var(--ff-border)",
              }}
              onMouseEnter={(e) => { if (c.isDir) e.currentTarget.style.background = "var(--ff-bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 7, overflow: "hidden" }}>
                {c.isDir ? <Icons.Folder size={16} /> : <Icons.File size={16} />}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                {c.partial && <span title="扫描被取消或超限，数值偏小" style={{ fontSize: 10, color: "var(--ff-accent)" }}>部分</span>}
              </span>
              <span style={{ textAlign: "right", color: "var(--ff-text-primary)", fontVariantNumeric: "tabular-nums" }}>{fmtSize(c.size)}</span>
              <span style={{ height: 8, borderRadius: 4, background: "var(--ff-border)", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${Math.max(2, (c.size / maxSize) * 100)}%`, background: c.isDir ? "var(--ff-primary)" : "var(--ff-text-disabled)" }} />
              </span>
              <span style={{ textAlign: "right", color: "var(--ff-text-secondary)", fontSize: 12 }}>{parentSize > 0 ? `${((c.size / parentSize) * 100).toFixed(1)}%` : "—"}</span>
              <span style={{ textAlign: "right", color: "var(--ff-text-disabled)", fontSize: 12 }}>{c.isDir ? `${c.files} 文件` : ""}</span>
            </div>
          ))}
          {current.result.children.length > 200 && (
            <div style={{ padding: 10, textAlign: "center", fontSize: 12, color: "var(--ff-text-disabled)" }}>
              子项过多，仅显示前 200 项（共 {current.result.children.length} 项）
            </div>
          )}
        </div>
      )}

      {/* Top 大文件 */}
      {current && current.result.topFiles.length > 0 && (
        <>
          <h4 style={{ margin: "0 0 8px", fontSize: 12, color: "var(--ff-text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>Top {current.result.topFiles.length} 大文件（本次扫描范围）</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 20 }}>
            {current.result.topFiles.slice(0, 15).map((f) => (
              <div key={f.path} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, padding: "4px 8px", borderRadius: 6 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ff-bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Icons.File size={14} />
                <span title={f.path} style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ff-text-secondary)" }}>{f.path}</span>
                <span style={{ width: 90, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtSize(f.size)}</span>
                <button className="btn-ghost" style={{ fontSize: 11 }} title="在资源管理器中显示"
                  onClick={() => api.fsReveal(f.path).catch(() => {})}>定位</button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 清理面板 */}
      <h4 style={{ margin: "0 0 8px", fontSize: 12, color: "var(--ff-text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>磁盘清理</h4>
      <div style={{ border: "1px solid var(--ff-border)", borderRadius: 10, padding: 14 }}>
        {!targets && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "var(--ff-text-secondary)" }}>扫描常见缓存/临时文件的占用（用户临时、浏览器缓存、缩略图、npm/pip、回收站等）</span>
            <button className="btn-primary" disabled={targetsLoading} onClick={scanTargets} style={{ marginLeft: "auto" }}>
              {targetsLoading ? "扫描中…" : "扫描可清理项"}
            </button>
          </div>
        )}
        {targets && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
              {targets.map((t) => (
                <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: t.cleanable ? "pointer" : "default", opacity: t.cleanable ? 1 : 0.55 }}>
                  <input type="checkbox" disabled={!t.cleanable || cleaning}
                    checked={!!checked[t.id]}
                    onChange={(e) => setChecked((prev) => ({ ...prev, [t.id]: e.target.checked }))} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{t.name} <span style={{ color: "var(--ff-text-primary)", marginLeft: 6 }}>{t.cleanable ? fmtSize(t.size) : "0 B"}</span></div>
                    <div style={{ fontSize: 11, color: "var(--ff-text-disabled)" }}>{t.description}{t.partial ? " · 大小为估算（部分文件无法读取）" : ""}</div>
                  </div>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-ghost" disabled={cleaning} onClick={scanTargets}>↻ 重新扫描</button>
              <button className="btn-primary" disabled={cleaning || Object.values(checked).every((v) => !v)}
                style={Object.values(checked).some((v) => v) ? { background: "var(--ff-danger)", borderColor: "var(--ff-danger)" } : undefined}
                onClick={executeClean}>
                {cleaning ? "清理中…" : "清理选中项（永久删除）"}
              </button>
              <span style={{ fontSize: 11, color: "var(--ff-text-disabled)", alignSelf: "center" }}>
                仅删除缓存内容本身；密码、书签、历史、个人文档不受影响
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
