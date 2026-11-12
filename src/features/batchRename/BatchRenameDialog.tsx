// 批量重命名（P1：规则式 序号/日期/替换/正则，对齐 TC）
import React, { useState } from "react";
import { Modal } from "@/components/ui";
import { api } from "@/ipc/client";
import { useApp } from "@/features/settings/appStore";

export const BatchRenameDialog: React.FC = () => {
  const open = useApp((s) => s.batchRenameOpen);
  const toggleOpen = useApp((s) => s.toggleOpen);
  const selection = useApp((s) => s.selection);
  const [mode, setMode] = useState<"sequence" | "date" | "replace">("sequence");
  const [pattern, setPattern] = useState("");
  const [replacement, setReplacement] = useState("");
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [start, setStart] = useState(1);
  const [useRegex, setUseRegex] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);

  const run = async () => {
    const done = await api.fsBatchRename(selection, {
      mode, pattern: pattern || undefined, replacement: replacement || undefined,
      prefix: prefix || undefined, suffix: suffix || undefined, start, useRegex,
    });
    setResult(done);
    window.dispatchEvent(new CustomEvent("ff-refresh"));
  };

  return (
    <Modal open={open} onClose={() => { toggleOpen("batchRenameOpen"); setResult(null); }} title={`批量重命名（已选 ${selection.length} 项）`} width={560}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {([["sequence", "序号"], ["date", "日期"], ["replace", "查找替换"]] as const).map(([m, label]) => (
          <button key={m} className="btn-ghost"
            style={mode === m ? { background: "var(--ff-bg-selected)", color: "var(--ff-primary)" } : undefined}
            onClick={() => setMode(m)}>{label}</button>
        ))}
      </div>

      <Grid>
        {(mode === "sequence" || mode === "date") && (
          <>
            <L>前缀</L><input value={prefix} onChange={(e) => setPrefix(e.target.value)} style={inp} placeholder="如 会议-" />
            <L>后缀</L><input value={suffix} onChange={(e) => setSuffix(e.target.value)} style={inp} placeholder="如 _v2" />
          </>
        )}
        {mode === "sequence" && (
          <>
            <L>起始序号</L><input type="number" value={start} onChange={(e) => setStart(+e.target.value)} style={inp} />
            <L>预览</L><span style={{ fontSize: 12, color: "var(--ff-text-secondary)" }}>{prefix}0001{suffix}.ext</span>
          </>
        )}
        {mode === "replace" && (
          <>
            <L>查找</L><input value={pattern} onChange={(e) => setPattern(e.target.value)} style={inp} />
            <L>替换为</L><input value={replacement} onChange={(e) => setReplacement(e.target.value)} style={inp} />
            <L>正则模式</L><input type="checkbox" checked={useRegex} onChange={(e) => setUseRegex(e.target.checked)} />
          </>
        )}
        {mode === "date" && <L>预览</L>}
      </Grid>

      {result && (
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--ff-success)", maxHeight: 120, overflowY: "auto" }}>
          已重命名 {result.length} 项：<br />
          {result.slice(0, 100).map((r) => <div key={r}>{r.split(/[\\/]/).pop()}</div>)}
          {result.length > 100 && <div>… 其余 {result.length - 100} 项省略</div>}
        </div>
      )}

      <button className="btn-primary" style={{ marginTop: 16, width: "100%" }} disabled={selection.length === 0} onClick={run}>
        应用到 {selection.length} 个选中文件
      </button>
      {selection.length === 0 && <p style={{ fontSize: 12, color: "var(--ff-text-secondary)" }}>请先在文件列表中选中文件。</p>}
    </Modal>
  );
};

const Grid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: "10px 12px", alignItems: "center" }}>{children}</div>
);
const L: React.FC<{ children: React.ReactNode }> = ({ children }) => <span style={{ fontSize: 13, color: "var(--ff-text-secondary)" }}>{children}</span>;
const inp: React.CSSProperties = {
  padding: "7px 10px", borderRadius: 8, fontSize: 13, background: "var(--ff-bg-app)",
  color: "var(--ff-text-primary)", border: "1px solid var(--ff-border)",
};
