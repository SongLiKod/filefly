// 多标签页栏（F-04：多标签、中键/按钮关闭、新建；§9 规格对齐）
import React from "react";
import { useTabs } from "./tabsStore";
import { Icons } from "@/components/Icons";

export const TabsBar: React.FC = () => {
  const { tabs, activeTabId, addTab, closeTab, activate } = useTabs();
  return (
    <div
      className="glass"
      style={{
        display: "flex", alignItems: "center", gap: 4, padding: "6px 8px 0",
        background: "var(--ff-bg-sidebar)",
        borderBottom: "1px solid var(--ff-border)",
      }}
    >
      {tabs.map((t) => {
        const active = t.id === activeTabId;
        return (
          <div
            key={t.id}
            className={`tab${active ? " active" : ""}`}
            onClick={() => activate(t.id)}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } }}
            title={t.path}
          >
            <Icons.Folder size={14} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
            <span className="tab-close" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} title="关闭 (中键点击同样关闭)">
              <Icons.Close size={12} />
            </span>
          </div>
        );
      })}
      <button className="btn-ghost" title="新建标签页 (Ctrl+T)" onClick={() => addTab()} style={{ marginBottom: 4 }}>
        <Icons.Plus />
      </button>
    </div>
  );
};
