// 通用小组件：标签 Chip、磁盘容量条（主题 §8.6）、上下文菜单、模态框、加载指示
import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { useTags } from "@/features/tags/tagStore";
import { Icons } from "./Icons";

// —— 统一加载指示（F-09/F-06/F-22 等异步视图共用）——

/** 旋转 spinner（.spin 动画，global.css） */
export const Spinner: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <span
    className="spin"
    style={{
      width: size, height: size, flexShrink: 0, display: "inline-block", borderRadius: "50%",
      border: "2px solid var(--ff-border)", borderTopColor: "var(--ff-primary)",
    }}
  />
);

/** 行内/居中加载提示：spinner + 文案 */
export const LoadingHint: React.FC<{ text?: string; center?: boolean; padding?: number }> = ({ text = "加载中…", center, padding = 16 }) => (
  <div style={{
    display: "flex", alignItems: "center", gap: 8, padding,
    justifyContent: center ? "center" : "flex-start",
    color: "var(--ff-text-secondary)", fontSize: 13,
  }}>
    <Spinner /> {text}
  </div>
);

/** 骨架行：数据未就绪时的占位 shimmer */
export const SkeletonRows: React.FC<{ rows?: number; padding?: number }> = ({ rows = 6, padding = 16 }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 12, padding }}>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="sk-row" style={{ width: `${92 - (i % 4) * 16}%` }} />
    ))}
  </div>
);

export const TagChip: React.FC<{ name: string; size?: number; onRemove?: () => void }> = ({ name, size = 12, onRemove }) => {
  const { defs } = useTags();
  const color = defs.find((d) => d.name === name)?.color ?? "#8B8D98";
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        fontSize: size, padding: "1px 6px", borderRadius: 8,
        background: `${color}22`, color,
        border: `1px solid ${color}55`,
      }}
      onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
      title={onRemove ? "点击移除标签" : name}
    >
      <span style={{ width: 6, height: 6, borderRadius: 3, background: color }} />
      {name}
      {onRemove && <Icons.Close size={9} />}
    </span>
  );
};

/** 磁盘容量条：<70% accent 实色；70~89% warning；≥90% danger（技术文档 §8.6） */
export const DiskBar: React.FC<{ total: number; free: number; label?: string }> = ({ total, free, label }) => {
  const usedPct = total > 0 ? Math.min(100, Math.round(((total - free) / total) * 100)) : 0;
  const color = usedPct >= 90 ? "var(--ff-danger)" : usedPct >= 70 ? "var(--ff-warning)" : "var(--ff-accent)";
  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ff-text-secondary)", marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: usedPct >= 70 ? color : "var(--ff-text-secondary)" }}>{usedPct}% 已用</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "var(--ff-border)", overflow: "hidden" }}>
        <div style={{ width: `${usedPct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 300ms" }} />
      </div>
    </div>
  );
};

// —— 轻量上下文菜单 ——
export interface MenuItem {
  label?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  submenu?: MenuItem[];
  separator?: boolean;
  disabled?: boolean;
}

interface CtxState { x: number; y: number; items: MenuItem[] }
const CtxCtx = createContext<{ open: (e: React.MouseEvent, items: MenuItem[]) => void }>({ open: () => {} });
export const useContextMenu = () => useContext(CtxCtx);

export const ContextMenuProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const [submenu, setSubmenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  useEffect(() => {
    const close = () => { setCtx(null); setSubmenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("blur", close); };
  }, []);
  return (
    <CtxCtx.Provider value={{ open: (e, items) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, items }); setSubmenu(null); } }}>
      {children}
      {ctx && (
        <div
          className="glass"
          style={{
            position: "fixed", left: ctx.x, top: ctx.y, zIndex: 1000, minWidth: 180,
            background: "var(--ff-bg-card)", border: "1px solid var(--ff-border)", borderRadius: 8,
            boxShadow: "0 8px 32px rgba(0,0,0,.18)", padding: 4, fontSize: 13,
          }}
        >
          {ctx.items.map((it, i) =>
            it.separator ? (
              <div key={i} style={{ height: 1, background: "var(--ff-border)", margin: "4px 0" }} />
            ) : (
              <div
                key={i}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 6,
                  cursor: it.disabled ? "default" : "pointer", color: it.disabled ? "var(--ff-text-disabled)" : "var(--ff-text-primary)",
                  position: "relative",
                }}
                onMouseEnter={(e) => {
                  if (it.submenu) {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setSubmenu({ x: r.right + 4, y: r.top, items: it.submenu });
                  } else setSubmenu(null);
                }}
                onClick={() => { if (!it.disabled && !it.submenu) { it.onClick?.(); setCtx(null); } }}
              >
                {it.icon}
                <span style={{ flex: 1 }}>{it.label}</span>
                {it.submenu && <span style={{ color: "var(--ff-text-disabled)" }}>›</span>}
              </div>
            )
          )}
        </div>
      )}
      {submenu && (
        <div
          className="glass"
          style={{
            position: "fixed", left: submenu.x, top: submenu.y, zIndex: 1001, minWidth: 160,
            background: "var(--ff-bg-card)", border: "1px solid var(--ff-border)", borderRadius: 8,
            boxShadow: "0 8px 32px rgba(0,0,0,.18)", padding: 4, fontSize: 13,
          }}
        >
          {submenu.items.map((it, i) => (
            <div key={i}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 6, cursor: "pointer" }}
              onClick={() => { it.onClick?.(); setCtx(null); setSubmenu(null); }}
            >
              {it.icon}
              {it.label}
            </div>
          ))}
        </div>
      )}
    </CtxCtx.Provider>
  );
};

// —— 模态框 ——
export const Modal: React.FC<{ open: boolean; onClose: () => void; title: string; width?: number; children: React.ReactNode }> = ({ open, onClose, title, width = 520, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="glass" style={{ width, maxHeight: "80vh", overflow: "auto", background: "var(--ff-bg-card)", border: "1px solid var(--ff-border)", borderRadius: 12, boxShadow: "0 16px 48px rgba(0,0,0,.24)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--ff-border)" }}>
          <strong style={{ fontSize: 15 }}>{title}</strong>
          <button className="btn-ghost" onClick={onClose} style={{ padding: 4 }}><Icons.Close /></button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
};
