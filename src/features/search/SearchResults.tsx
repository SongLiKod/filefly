// 搜索结果视图（F-09~F-12：拼音匹配、语法过滤、关键词高亮、按日期排序、直达所在文件夹）
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/ipc/client";
import type { EntryMeta, SearchHit } from "@/ipc/types";
import { fmtSize, fmtDate } from "@/ipc/types";
import { parseQuery } from "./queryParser";
import { useTabs } from "@/features/tabs/tabsStore";
import { useApp } from "@/features/settings/appStore";
import { openEntrySmart } from "@/utils/openEntry";
import { Icons } from "@/components/Icons";
import { SkeletonRows, Spinner } from "@/components/ui";

/** 关键词高亮（F-12，--ff-highlight 底色） */
export const Highlighted: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  const parts = useMemo(() => {
    if (!query.trim()) return [{ t: text, hit: false }];
    const out: { t: string; hit: boolean }[] = [];
    const lower = text.toLowerCase();
    const q = query.toLowerCase().trim();
    let i = 0;
    while (i < text.length) {
      const at = lower.indexOf(q, i);
      if (at < 0) { out.push({ t: text.slice(i), hit: false }); break; }
      if (at > i) out.push({ t: text.slice(i, at), hit: false });
      out.push({ t: text.slice(at, at + q.length), hit: true });
      i = at + q.length;
    }
    return out;
  }, [text, query]);
  return (
    <>
      {parts.map((p, i) => (p.hit ? <span key={i} className="hl">{p.t}</span> : <span key={i}>{p.t}</span>))}
    </>
  );
};

export const SearchResults: React.FC<{ query: string }> = ({ query }) => {
  const navigate = useTabs((s) => s.navigate);
  const addTab = useTabs((s) => s.addTab);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(true);
  const parsed = useMemo(() => parseQuery(query), [query]);
  // 单击/双击区分：单击 220ms 后新开标签页；双击先取消该定时器再打开文件本身
  const clickTimer = useRef<number | null>(null);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      // 80ms 防抖（技术文档 §9 搜索规格）
      api.searchQuery(parsed, 500).then((r) => { setHits(r); setLoading(false); }).catch(() => setLoading(false));
    }, 80);
    return () => clearTimeout(t);
  }, [parsed]);

  const toEntry = (h: SearchHit): EntryMeta => ({
    name: h.name, path: h.path, isDir: h.isDir, size: h.size, mtime: h.mtime,
    ext: h.ext, hidden: false, placeholderState: "none", tags: [],
  });

  // F-12 直达所在文件夹：在新标签页打开（不打断当前搜索结果页），并自动选中/滚动到该条目
  const openDirInNewTab = (h: SearchHit) => {
    const dir = h.path.split(/[\\/]/).slice(0, -1).join("\\");
    if (h.isDir && dir) {
      addTab(h.path);
      useApp.getState().setPendingReveal(null);
    } else {
      addTab(dir || h.path);
      useApp.getState().setPendingReveal(h.path);
    }
  };

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "20px 28px", background: "var(--ff-bg-content)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, display: "flex", alignItems: "center", gap: 8 }}><Icons.Search /> 搜索</h2>
        <span style={{ color: "var(--ff-text-secondary)", fontSize: 13 }}>
          「{query}」{loading ? "· 搜索中…" : `· ${hits.length} 个结果 · 按修改日期排序`}
        </span>
        {loading && <Spinner size={14} />}
      </div>
      {loading ? (
        <SkeletonRows rows={8} />
      ) : (
      <>
      {hits.map((h) => (
        <div
          key={h.path + h.name}
          style={{
            display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, fontSize: 13, cursor: "default",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ff-bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          onClick={() => {
            // 单击结果行 = 直达所在文件夹（新标签页打开）
            if (clickTimer.current !== null) return;
            clickTimer.current = window.setTimeout(() => {
              clickTimer.current = null;
              openDirInNewTab(h);
            }, 220);
          }}
          onDoubleClick={() => {
            if (clickTimer.current !== null) { clearTimeout(clickTimer.current); clickTimer.current = null; }
            void openEntrySmart(h.path, h.isDir, () => navigate(h.path));
          }}
        >
          {h.isDir ? <Icons.Folder size={17} /> : <Icons.File size={17} />}
          <span style={{ minWidth: 220 }}><Highlighted text={h.name} query={parsed.text} /></span>
          <span style={{ flex: 1, color: "var(--ff-text-secondary)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.path}</span>
          {/* 直达所在文件夹（F-12）：新标签页打开 */}
          <button className="btn-ghost" title="在新标签页打开所在文件夹" onClick={(e) => { e.stopPropagation(); openDirInNewTab(h); }}>
            <Icons.Folder size={14} color="var(--ff-accent)" />
          </button>
          <span style={{ width: 90, textAlign: "right", color: "var(--ff-text-secondary)", fontSize: 12 }}>{h.isDir ? "—" : fmtSize(h.size)}</span>
          <span style={{ width: 120, textAlign: "right", color: "var(--ff-text-disabled)", fontSize: 12 }}>{fmtDate(h.mtime)}</span>
        </div>
      ))}
      {!loading && hits.length === 0 && (
        <div style={{ color: "var(--ff-text-secondary)", padding: 40, textAlign: "center" }}>没有匹配结果。试试语法：<code>size:&gt;100MB</code>、<code>ext:pdf</code>、<code>modified:today</code>、<code>tag:工作</code></div>
      )}
      </>
      )}
    </div>
  );
};
