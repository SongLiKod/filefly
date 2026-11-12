// 重复文件查找与清理建议（P1）
import React, { useEffect, useState } from "react";
import { Modal } from "@/components/ui";
import { api } from "@/ipc/client";
import { fmtSize } from "@/ipc/types";
import { Icons } from "@/components/Icons";
import { useApp } from "@/features/settings/appStore";

export const DuplicatesDialog: React.FC = () => {
  const open = useApp((s) => s.duplicatesOpen);
  const toggleOpen = useApp((s) => s.toggleOpen);
  const specialDirs = useApp((s) => s.specialDirs);
  const [groups, setGroups] = useState<{ size: number; name: string; paths: string[] }[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [roots, setRoots] = useState<string[]>([]);

  // 真实扫描范围：用户主目录 + 除主目录所在盘外的所有磁盘
  useEffect(() => {
    if (!open) return;
    (async () => {
      const list: string[] = [];
      if (specialDirs?.home) list.push(specialDirs.home);
      try {
        const drives = await api.fsDrives();
        const homeDrive = specialDirs?.home?.slice(0, 2).toLowerCase();
        for (const d of drives) {
          if (d.path.slice(0, 2).toLowerCase() !== homeDrive) list.push(d.path);
        }
      } catch { /* ignore */ }
      setRoots(list);
    })();
  }, [open, specialDirs]);

  const scan = async () => {
    if (roots.length === 0) return;
    setScanning(true);
    try {
      setGroups(await api.fsDuplicatesScan(roots, 5));
    } finally {
      setScanning(false);
    }
  };

  const remove = async (path: string) => {
    await api.fsOperation("delete", [path]);
    await scan();
  };

  return (
    <Modal open={open} onClose={() => toggleOpen("duplicatesOpen")} title="重复文件查找" width={680}>
      <p style={{ fontSize: 13, color: "var(--ff-text-secondary)", margin: "0 0 12px" }}>
        扫描范围：{roots.length > 0 ? roots.join("、") : "检测中…"}<br />
        三阶段确认（大小 → 头部哈希 → 全文件 SHA256），只有内容完全一致才算重复；建议保留一份，其余清理。
      </p>
      {!groups && !scanning && <button className="btn-primary" onClick={scan} disabled={roots.length === 0}>开始扫描</button>}
      {scanning && <div style={{ color: "var(--ff-text-secondary)" }}><span className="spin" style={{ display: "inline-block" }}>◌</span> 扫描中…</div>}
      {groups && groups.slice(0, 200).map((g, i) => (
        <div key={i} style={{ marginBottom: 12, border: "1px solid var(--ff-border)", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            <Icons.Duplicate size={13} /> {g.name} <span style={{ color: "var(--ff-text-secondary)", fontWeight: 400 }}>· {g.paths.length} 份 · {fmtSize(g.size)}</span>
          </div>
          {g.paths.slice(0, 20).map((p, j) => (
            <div key={p} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0", color: j === 0 ? "var(--ff-success)" : "var(--ff-text-secondary)" }}>
              {j === 0 ? "✓ 保留" : "· 重复"} <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
              {j > 0 && <button className="btn-ghost" onClick={() => remove(p)}><Icons.Trash size={12} /> 清理</button>}
            </div>
          ))}
          {g.paths.length > 20 && <div style={{ fontSize: 11, color: "var(--ff-text-disabled)" }}>… 该组还有 {g.paths.length - 20} 个路径未显示</div>}
        </div>
      ))}
      {groups && groups.length > 200 && (
        <div style={{ fontSize: 12, color: "var(--ff-text-disabled)", padding: "4px 0" }}>重复组过多，仅显示前 200 组（共 {groups.length} 组）</div>
      )}
      {groups && groups.length === 0 && <div style={{ color: "var(--ff-text-secondary)", fontSize: 13 }}>未发现重复文件。</div>}
    </Modal>
  );
};
