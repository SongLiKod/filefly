// 主题化对话框系统（替代原生 window.alert/confirm/prompt）
// Promise 风格 API：alertDialog / confirmDialog / promptDialog，DialogHost 挂载于 App 根部
import React, { useEffect, useRef, useState } from "react";
import { create } from "zustand";

type Tone = "info" | "success" | "error" | "warning";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface BaseReq { title: string; message?: string; tone?: Tone; resolve: (v: any) => void; }
interface AlertReq extends BaseReq { kind: "alert" }
interface ConfirmReq extends BaseReq { kind: "confirm"; danger?: boolean; confirmText?: string; cancelText?: string }
interface PromptReq extends BaseReq { kind: "prompt"; value?: string; placeholder?: string; password?: boolean; danger?: boolean; confirmText?: string }
type Req = AlertReq | ConfirmReq | PromptReq;

interface DlgState { queue: Req[]; push: (r: Req) => void; drop: () => void; }
const useDlg = create<DlgState>((set) => ({
  queue: [],
  push: (r) => set((s) => ({ queue: [...s.queue, r] })),
  drop: () => set((s) => ({ queue: s.queue.slice(1) })),
}));

export const alertDialog = (title: string, message?: string, tone: Tone = "info") =>
  new Promise<void>((resolve) => useDlg.getState().push({ kind: "alert", title, message, tone, resolve }));

export const confirmDialog = (title: string, message?: string, opts: { danger?: boolean; confirmText?: string; cancelText?: string } = {}) =>
  new Promise<boolean>((resolve) => useDlg.getState().push({ kind: "confirm", title, message, ...opts, resolve }));

export const promptDialog = (title: string, opts: { message?: string; value?: string; placeholder?: string; password?: boolean; danger?: boolean; confirmText?: string } = {}) =>
  new Promise<string | null>((resolve) => useDlg.getState().push({ kind: "prompt", title, ...opts, resolve }));

const TONE_META: Record<Tone, { glyph: string; color: string; bg: string }> = {
  info: { glyph: "i", color: "var(--ff-primary)", bg: "rgba(46,107,230,.12)" },
  success: { glyph: "✓", color: "var(--ff-success)", bg: "rgba(31,157,85,.12)" },
  error: { glyph: "✕", color: "var(--ff-danger)", bg: "rgba(220,38,38,.12)" },
  warning: { glyph: "!", color: "var(--ff-warning)", bg: "rgba(217,119,6,.12)" },
};

export const DialogHost: React.FC = () => {
  const queue = useDlg((s) => s.queue);
  const drop = useDlg((s) => s.drop);
  const req = queue[0];
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (req?.kind === "prompt") {
      setVal(req.value ?? "");
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [req]);

  if (!req) return null;

  const cancelValue = req.kind === "confirm" ? false : req.kind === "prompt" ? null : undefined;
  const finish = (v: unknown) => { req.resolve(v); drop(); };
  const confirm = () => {
    if (req.kind === "confirm") finish(true);
    else if (req.kind === "prompt") finish(val);
    else finish(undefined);
  };

  const tone = req.tone ?? (req.kind === "confirm" && (req as ConfirmReq).danger ? "warning" : "info");
  const m = TONE_META[tone];
  const danger = req.kind === "confirm" ? (req as ConfirmReq).danger : req.kind === "prompt" ? (req as PromptReq).danger : false;
  const confirmText = req.kind === "confirm" ? (req as ConfirmReq).confirmText ?? "确定" : req.kind === "prompt" ? (req as PromptReq).confirmText ?? "确定" : "知道了";
  const cancelText = req.kind === "confirm" ? (req as ConfirmReq).cancelText ?? "取消" : "取消";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 3000,
        background: "rgba(10,12,16,.42)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) finish(cancelValue); }}
    >
      <div
        className="card fade-up"
        role="dialog"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); finish(cancelValue); }
          if (e.key === "Enter" && req.kind !== "prompt") { e.preventDefault(); confirm(); }
        }}
        style={{
          width: 400, maxWidth: "calc(100vw - 48px)", padding: "20px 22px 18px", borderRadius: 14,
          boxShadow: "0 12px 48px rgba(10,12,16,.28)", outline: "none",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span
            style={{
              width: 34, height: 34, borderRadius: 10, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 15, fontWeight: 700, color: m.color, background: m.bg,
            }}
          >
            {m.glyph}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>{req.title}</div>
            {req.message && (
              <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.6, color: "var(--ff-text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all", userSelect: "text" }}>
                {req.message}
              </div>
            )}
            {req.kind === "prompt" && (
              <input
                ref={inputRef}
                type={(req as PromptReq).password ? "password" : "text"}
                value={val}
                placeholder={(req as PromptReq).placeholder}
                onChange={(e) => setVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirm(); } }}
                className="search-pill"
                style={{ marginTop: 12, width: "100%", flex: "unset", padding: "7px 12px" }}
              />
            )}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          {req.kind !== "alert" && (
            <button className="btn-ghost" onClick={() => finish(cancelValue)}>{cancelText}</button>
          )}
          <button
            className="btn-primary"
            autoFocus={req.kind !== "prompt"}
            onClick={confirm}
            style={danger ? { background: "var(--ff-danger)", boxShadow: "0 1px 3px rgba(220,38,38,.35)" } : undefined}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
