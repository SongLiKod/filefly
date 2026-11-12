// QuickLook 预览浮层（F-13~F-18，技术文档 §6/§9）
// 空格开、Esc 关、←→ 切文件、EXIF 抽屉、迷你播放器、硬解视频、PDF/Office
import React, { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { marked } from "marked";
import { api } from "@/ipc/client";
import type { CodePreview, ExifData, ImagePreview, MediaMeta, VaultItem } from "@/ipc/types";
import { fmtSize } from "@/ipc/types";
import { usePreview } from "./previewStore";
import { Icons } from "@/components/Icons";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export const PreviewOverlay: React.FC = () => {
  const { open, paths, index, close, step } = usePreview();
  const path = paths[index] ?? "";
  const name = path.split(/[\\/]/).pop() ?? "";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  // 全屏（覆盖整个窗口）：所有预览类型共用此容器，一处开关全部生效
  const [fs, setFs] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        // 分级退出：全屏先回普通预览，再次 Esc 才关闭浮层
        if (fs) setFs(false);
        else close();
      }
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "F11") { e.preventDefault(); setFs((v) => !v); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close, step, fs]);

  // 切换文件 / 关闭浮层时复位全屏
  useEffect(() => { setFs(false); }, [open, path]);

  if (!open || !path) return null;
  return (
    <div className="preview-overlay" style={{ position: "fixed", inset: 0, zIndex: 800 }}>
      {/* 预览蒙层（毛玻璃，技术文档 §8.1）；全屏时被面板完全覆盖不显示 */}
      <div className="glass" style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.55)" }} onClick={close} />
      <div
        style={{
          position: "absolute", inset: fs ? 0 : "4vh 6vw", display: "flex",
          borderRadius: fs ? 0 : 12, overflow: "hidden",
          background: "var(--ff-bg-card)", border: "1px solid var(--ff-border)", boxShadow: "0 24px 80px rgba(0,0,0,.4)",
        }}
      >
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--ff-border)", cursor: "default" }}
            onDoubleClick={() => setFs((v) => !v)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong style={{ fontSize: 14 }}>{name}</strong>
              <span style={{ fontSize: 12, color: "var(--ff-text-secondary)" }}>{index + 1} / {paths.length}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button className="btn-ghost" title={fs ? "退出全屏（F11 / 双击标题栏）" : "全屏预览（F11 / 双击标题栏）"} onClick={() => setFs((v) => !v)}>
                {fs ? <Icons.Minimize /> : <Icons.Maximize />}
              </button>
              <button className="btn-ghost" title="关闭预览（Esc）" onClick={close}><Icons.Close /></button>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {/* 预览内容单独包错误边界：内部崩溃只关浮层回主界面，绝不波及整个应用 */}
            <ErrorBoundary
              label="预览"
              fallback={(err, reset) => (
                <Centered>
                  <div style={{ textAlign: "center", maxWidth: 520 }}>
                    <div style={{ marginBottom: 10 }}>此文件的预览组件出现错误，已自动隔离</div>
                    <div style={{ color: "var(--ff-text-disabled)", fontSize: 12, fontFamily: "monospace", wordBreak: "break-all", marginBottom: 14 }}>{err.message}</div>
                    <button className="btn-primary" style={{ marginRight: 10 }} onClick={() => api.fsOpen(path)}>用系统默认程序打开</button>
                    <button className="btn-ghost" style={{ marginRight: 10 }} onClick={reset}>重试预览</button>
                    <button className="btn-ghost" onClick={close}>关闭预览，返回文件管理</button>
                  </div>
                </Centered>
              )}
            >
              <PreviewContent path={path} ext={ext} />
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
};

const PreviewContent: React.FC<{ path: string; ext: string }> = ({ path, ext }) => {
  if (["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "heic", "tiff", "ico"].includes(ext)) return <ImagePre path={path} />;
  if (ext === "pdf") return <PdfPre path={path} />;
  if (["docx", "doc", "xlsx", "pptx"].includes(ext)) return <OfficePre path={path} />;
  if (["ppt", "xls"].includes(ext)) return <OldOfficePre path={path} ext={ext} />;
  if (["md", "markdown", "mdown"].includes(ext)) return <MdPre path={path} />;
  if (["mp3", "flac", "wav", "ape", "ogg", "m4a", "aac"].includes(ext)) return <AudioPre path={path} ext={ext} />;
  if (["mp4", "mkv", "mov", "webm", "avi"].includes(ext)) return <VideoPre path={path} />;
  if (["zip", "7z", "rar"].includes(ext)) return <ArchivePre path={path} />;
  if (["exe", "msi", "msix", "msp", "bat", "cmd", "scr", "ps1"].includes(ext)) return <ExePre path={path} name={path.split(/[\\/]/).pop() ?? path} />;
  return <CodePre path={path} />;
};

const Centered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ff-text-secondary)", fontSize: 14 }}>{children}</div>
);

// 巨型 DOM 防卡死上限：一次性渲染几万节点会把 webview 主线程堵死（此前 pptx/xlsx 卡死的同类根因）
const MAX_XLSX_ROWS = 1000;
const MAX_XLSX_COLS = 60;
const MAX_DOC_PARAS = 2000;
const MAX_SLIDES = 300;
const MAX_ARCHIVE_MEMBERS = 2000;
const MAX_MD_CHARS = 1_000_000;

// asset 协议可达性探测：CSP/协议拦截时 <video>/<iframe> 是静默空白（无 error 事件），
// 用 fetch 主动探测（connect-src 回落 default-src，已放行 asset 源），失败即显式提示
function useAssetProbe(url: string, enabled = true): "probing" | "ok" | "fail" {
  const [state, setState] = useState<"probing" | "ok" | "fail">("probing");
  useEffect(() => {
    if (!enabled) return;
    setState("probing");
    let alive = true;
    const t = setTimeout(() => { if (alive) setState("fail"); }, 3000);
    fetch(url, { headers: { Range: "bytes=0-64" } })
      .then((r) => { if (alive) { clearTimeout(t); setState(r.ok || r.status === 206 ? "ok" : "fail"); } })
      .catch(() => { if (alive) { clearTimeout(t); setState("fail"); } });
    return () => { alive = false; clearTimeout(t); };
  }, [url, enabled]);
  return state;
}

/** 媒体源加载失败兜底：明确错误 + 回退系统程序打开 */
const MediaFail: React.FC<{ path: string; name: string }> = ({ path, name }) => (
  <Centered>
    <div style={{ textAlign: "center" }}>
      <div style={{ marginBottom: 10 }}>媒体源加载失败（asset 协议不可用）</div>
      <button className="btn-primary" onClick={() => api.fsOpen(path)}>用系统默认程序打开「{name}」</button>
    </div>
  </Centered>
);

// —— 图片预览（F-14：asset 协议直出原图 + EXIF 面板；放大后可拖拽平移、滚轮缩放、双击复位）——
const ImagePre: React.FC<{ path: string }> = ({ path }) => {
  const [exif, setExif] = useState<ExifData | null>(null);
  const [exifOpen, setExifOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fallbackB64, setFallbackB64] = useState<ImagePreview | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);
  const assetUrl = useMemo(() => convertFileSrc(path), [path]);
  const probe = useAssetProbe(assetUrl);

  useEffect(() => {
    let alive = true;
    setExif(null); setZoom(1); setOffset({ x: 0, y: 0 }); setLoaded(false); setFailed(false); setFallbackB64(null); setDecodeFailed(false); setExifOpen(false);
    api.previewExif(path).then((r) => { if (alive) setExif(r); }).catch(() => {});
    return () => { alive = false; };
  }, [path]);

  // 拖拽平移（放大后）：mousedown 记录起点，window mousemove 更新偏移
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setOffset({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  // 滚轮缩放（需要非被动监听才能阻止 WebView 页面缩放）
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(8, Math.max(0.2, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const setZoomClamped = (z: number) => {
    const nz = Math.min(8, Math.max(0.2, z));
    setZoom(nz);
    if (nz <= 1) setOffset({ x: 0, y: 0 }); // 缩回适应窗口时复位平移
  };

  // 兜底链：asset img(onError) → fetch 探测失败/1.6s 超时 → 后端解码 PNG base64 → 仍失败则显式错误 UI（绝不空白）
  const loadFallback = () => {
    if (fallbackB64 || decodeFailed) return;
    api.previewImage(path, 1600)
      .then((r) => { setFallbackB64(r); })
      .catch(() => setDecodeFailed(true));
  };
  const onImgError = () => {
    if (!failed) { setFailed(true); loadFallback(); }
    else setDecodeFailed(true); // base64 兜底图也加载失败 → 显式报错而非隐形
  };

  // 探测快速失败（CSP/协议拦截时 fetch 立即抛错，不用干等超时）
  useEffect(() => {
    if (probe === "fail" && !failed) { setFailed(true); loadFallback(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe]);

  // 静默失败兜底：CSP 拦截等情况下 <img> 既不触发 onLoad 也不触发 onError（元素隐形=一片空白）。
  // asset URL 1.6s 内仍未 onLoad 就强制切换后端 base64 解码，保证内容一定可见。
  useEffect(() => {
    if (failed || loaded) return;
    const t = setTimeout(() => { setFailed(true); loadFallback(); }, 1600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed, loaded, path]);
  const shown = !failed ? assetUrl : fallbackB64 ? `data:image/png;base64,${fallbackB64.dataBase64}` : "";

  // EXIF 有效字段（无 EXIF 的图片显示空状态而非空白）
  // 注意：后端 Option 序列化为 JSON null（历史坑：null !== undefined，null.toFixed 直接崩溃整窗）
  const exifFields: [string, string][] = exif
    ? ([
        ["相机", `${exif.make ?? ""} ${exif.model ?? ""}`.trim()],
        ["拍摄时间", exif.dateTime ?? ""],
        ["曝光", exif.exposure ?? ""],
        ["光圈", exif.fNumber ?? ""],
        ["ISO", exif.iso?.toString() ?? ""],
        ["焦距", exif.focalLength ?? ""],
        ["镜头", exif.lens ?? ""],
        ["GPS", exif.gpsLat != null && exif.gpsLng != null ? `${exif.gpsLat.toFixed(4)}, ${exif.gpsLng.toFixed(4)}` : ""],
      ] as [string, string][]).filter(([, v]) => v)
    : [];
  const hasExif = exifFields.length > 0;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        ref={stageRef}
        onMouseDown={(e) => {
          if (zoom > 1 && e.button === 0) {
            dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y };
            setDragging(true);
            e.preventDefault();
          }
        }}
        onDoubleClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}
        style={{
          flex: 1, minHeight: 0, position: "relative", overflow: "hidden", background: "var(--ff-bg-app)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "default",
        }}
      >
        {shown && !decodeFailed && (
          <img
            src={shown}
            alt=""
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={onImgError}
            style={{
              maxWidth: "100%", maxHeight: "100%", objectFit: "contain",
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: dragging ? "none" : "transform 120ms ease-out, opacity 160ms",
              opacity: loaded ? 1 : 0,
              userSelect: "none",
            }}
          />
        )}
        {decodeFailed && (
          <Centered>
            <div style={{ textAlign: "center" }}>
              <div style={{ marginBottom: 10 }}>该图片无法在内置预览中显示（asset 协议与后端解码均失败）</div>
              <button className="btn-primary" onClick={() => api.fsOpen(path)}>用系统默认程序打开</button>
            </div>
          </Centered>
        )}
        {!loaded && !decodeFailed && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <span className="spin" style={{ width: 24, height: 24, borderRadius: "50%", border: "3px solid var(--ff-border)", borderTopColor: "var(--ff-primary)", display: "inline-block" }} />
          </div>
        )}
        {zoom > 1 && (
          <div style={{ position: "absolute", top: 10, right: 12, fontSize: 11, color: "var(--ff-text-disabled)", background: "var(--ff-bg-card)", borderRadius: 6, padding: "2px 8px", pointerEvents: "none" }}>
            拖拽查看 · 双击复位
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderTop: "1px solid var(--ff-border)" }}>
        <button className="btn-ghost" onClick={() => setZoomClamped(zoom - 0.25)}><Icons.ZoomOut /></button>
        <span style={{ fontSize: 12, color: "var(--ff-text-secondary)", minWidth: 64, textAlign: "center" }}>{Math.round(zoom * 100)}%{fallbackB64 ? ` · ${fallbackB64.width}×${fallbackB64.height}` : ""}</span>
        <button className="btn-ghost" onClick={() => setZoomClamped(zoom + 0.25)}><Icons.ZoomIn /></button>
        <button className="btn-ghost" title="复位缩放与位置" onClick={() => { setZoomClamped(1); }}><span style={{ fontSize: 12 }}>1:1</span></button>
        <span style={{ flex: 1 }} />
        {hasExif && <button className="btn-ghost" onClick={() => setExifOpen((v) => !v)}>EXIF</button>}
      </div>
      {exifOpen && (
        <div className="glass" style={{ background: "var(--ff-bg-sidebar)", borderTop: "1px solid var(--ff-border)", padding: "12px 16px", fontSize: 12 }}>
          {hasExif ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {exifFields.map(([k, v]) => <ExifItem key={k} k={k} v={v} />)}
            </div>
          ) : (
            <div style={{ color: "var(--ff-text-secondary)" }}>该图片没有 EXIF 元数据（截图、网络图片通常没有）。</div>
          )}
        </div>
      )}
    </div>
  );
};
const ExifItem: React.FC<{ k: string; v?: string }> = ({ k, v }) => (
  <div><span style={{ color: "var(--ff-text-secondary)" }}>{k}</span><div style={{ color: v ? undefined : "var(--ff-text-disabled)" }}>{v ?? "—"}</div></div>
);

// —— 文本类预览缩放（与 PDF 观感一致：± 按钮 / 百分比 / Ctrl+滚轮 / 复位）——
const clampZoom = (z: number) => Math.min(3, Math.max(0.5, Math.round(z * 100) / 100));
const ZoomBar: React.FC<{ zoom: number; onChange: (z: number) => void }> = ({ zoom, onChange }) => (
  <div style={{ position: "absolute", right: 14, bottom: 14, display: "flex", alignItems: "center", gap: 2, background: "var(--ff-bg-card)", border: "1px solid var(--ff-border)", borderRadius: 8, padding: "2px 6px", boxShadow: "0 4px 14px rgba(0,0,0,.18)", zIndex: 6 }}>
    <button className="btn-ghost" title="缩小（Ctrl+滚轮）" onClick={() => onChange(clampZoom(zoom - 0.25))}><Icons.ZoomOut /></button>
    <span style={{ fontSize: 12, color: "var(--ff-text-secondary)", minWidth: 46, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
    <button className="btn-ghost" title="放大（Ctrl+滚轮）" onClick={() => onChange(clampZoom(zoom + 0.25))}><Icons.ZoomIn /></button>
    <button className="btn-ghost" title="复位 100%" onClick={() => onChange(1)}><span style={{ fontSize: 12 }}>1:1</span></button>
  </div>
);
// Ctrl+滚轮缩放：原生非 passive 监听才能 preventDefault（否则触发 webview 页面缩放）
function useCtrlWheelZoom(ref: React.RefObject<HTMLElement | null>, zoom: number, onChange: (z: number) => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      onChange(clampZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref, zoom, onChange]);
}

// —— 代码/文本预览（F-15：语法高亮、行号、大文件流式）——
const CodePre: React.FC<{ path: string }> = ({ path }) => {
  const [code, setCode] = useState<CodePreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  useCtrlWheelZoom(scrollRef, zoom, setZoom);
  useEffect(() => { setZoom(1); }, [path]);
  useEffect(() => {
    let alive = true;
    setCode(null);
    setErr(null);
    // 看门狗：加载 20s 未返回就显式报错，绝不无限停留在加载态
    const t = setTimeout(() => { if (alive) setErr("文本预览加载超时"); }, 20000);
    api.previewCode(path)
      .then((r) => { if (alive) { clearTimeout(t); setCode(r); } })
      .catch((e) => { if (alive) { clearTimeout(t); setErr(String(e)); } });
    return () => { alive = false; clearTimeout(t); };
  }, [path]);
  if (err) return (
    <Centered>
      <div style={{ textAlign: "center" }}>
        <div style={{ marginBottom: 10 }}>{err.includes("BINARY_FILE") ? "二进制文件不支持文本预览" : `文本预览加载失败：${err}`}</div>
        <button className="btn-primary" onClick={() => api.fsOpen(path)}>用系统默认程序打开</button>
      </div>
    </Centered>
  );
  if (!code) return <Centered>加载中…</Centered>;
  // 行数/行宽双上限：防止巨型文件一次性渲染几十万行把 webview 卡死
  const MAX_ROWS = 3000;
  const MAX_COLS = 2000;
  const lines = code.text.split("\n").slice(0, MAX_ROWS).map((l) => (l.length > MAX_COLS ? l.slice(0, MAX_COLS) + " …" : l));
  // token → 行列定位
  const spanAt = (lineIdx: number, col: number, len: number) => {
    let offset = 0;
    for (let i = 0; i < lineIdx; i++) offset += lines[i].length + 1;
    const start = offset + col;
    return code.highlightSpans.find((s) => s.start <= start && start < s.end && s.start < start + len);
  };
  const COLOR: Record<string, string> = {
    keyword: "#C678DD", string: "#98C379", number: "#D19A66", comment: "#5C6370", function: "#61AFEF",
  };
  return (
    <div style={{ position: "relative", height: "100%" }}>
    <div ref={scrollRef} style={{ height: "100%", overflow: "auto", zoom, background: "var(--ff-bg-app)", fontFamily: "var(--ff-font-mono, 'Cascadia Code', monospace)", fontSize: 13, lineHeight: 1.6 }}>
      {code.truncated && <div style={{ padding: "6px 14px", fontSize: 12, color: "var(--ff-warning)", background: "var(--ff-bg-card)" }}>大文件，仅加载前 {fmtSize(code.totalSize)}（流式加载）</div>}
      <div style={{ padding: "12px 0" }}>
        {lines.map((line, i) => (
          <div key={i} style={{ display: "flex" }}>
            <span style={{ width: 52, flexShrink: 0, textAlign: "right", paddingRight: 14, color: "var(--ff-text-disabled)", userSelect: "none" }}>{i + 1}</span>
            <span style={{ whiteSpace: "pre", paddingRight: 16 }}>
              {Array.from({ length: Math.min(line.length, 1) }).map((_, ci) => {
                const span = spanAt(i, ci, line.length);
                return <span key={ci} style={{ color: span ? COLOR[span.kind] : undefined }}>{line.slice(ci, ci + 1)}</span>;
              })}
              <span style={{ color: line.length ? spanAt(i, 0, line.length)?.kind === "keyword" ? COLOR.keyword : undefined : undefined }}>{line.slice(1)}</span>
            </span>
          </div>
        ))}
      </div>
      <div style={{ padding: "4px 14px 10px", fontSize: 11, color: "var(--ff-text-disabled)" }}>
        {code.language} · {code.lineCount} 行{code.text.split("\n").length > MAX_ROWS ? `（仅显示前 ${MAX_ROWS} 行）` : ""} · Tree-sitter/Shiki 高亮管线（Rust token 流）
      </div>
    </div>
    <ZoomBar zoom={zoom} onChange={setZoom} />
    </div>
  );
};

// —— 音频预览（F-16：封面、内嵌 LRC 歌词、真实音源播放）——
const AudioPre: React.FC<{ path: string; ext: string }> = ({ path, ext }) => {
  const [meta, setMeta] = useState<MediaMeta | null>(null);
  const [t, setT] = useState(0);
  const url = useMemo(() => convertFileSrc(path), [path]);
  useEffect(() => {
    api.previewMediaMeta(path).then(setMeta).catch(() => {});
  }, [path]);
  const lrcLines = useMemo(() => (meta?.lyricsLrc ?? "").split("\n").filter(Boolean), [meta]);
  const activeLrc = lrcLines.findIndex((l, i) => {
    const m = l.match(/\[(\d+):(\d+)/);
    if (!m) return false;
    const start = +m[1] * 60 + +m[2];
    const next = lrcLines[i + 1]?.match(/\[(\d+):(\d+)/);
    const end = next ? +next[1] * 60 + +next[2] : 9999;
    return t >= start && t < end;
  });
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "var(--ff-bg-app)" }}>
      <div style={{ width: 160, height: 160, borderRadius: 12, overflow: "hidden", background: "var(--ff-bg-card)", boxShadow: "0 8px 32px rgba(0,0,0,.2)" }}>
        {meta?.coverBase64 ? <img src={`data:image/jpeg;base64,${meta.coverBase64}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> :
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}><Icons.Music size={40} /></div>}
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{path.split(/[\\/]/).pop()}</div>
        <div style={{ fontSize: 12, color: "var(--ff-text-secondary)", marginTop: 4 }}>
          {ext.toUpperCase()} {meta?.lossless && <span style={{ color: "var(--ff-accent)", border: "1px solid var(--ff-accent)", borderRadius: 4, padding: "0 4px", marginLeft: 4 }}>无损</span>} · {meta?.sampleRate ?? 44100} Hz
        </div>
      </div>
      {/* 播放器（asset 协议直出真实音源） */}
      {useAssetProbe(url) === "fail"
        ? <MediaFail path={path} name={path.split(/[\\/]/).pop() ?? ""} />
        : <audio src={url} controls autoPlay style={{ width: "min(520px, 80%)" }} onTimeUpdate={(e) => setT((e.target as HTMLAudioElement).currentTime)} />}
      {/* 内嵌歌词 */}
      {lrcLines.length > 0 && (
        <div style={{ height: 110, overflow: "hidden", textAlign: "center", fontSize: 13 }}>
          {lrcLines.map((l, i) => (
            <div key={i} style={{ color: i === activeLrc ? "var(--ff-primary)" : "var(--ff-text-disabled)", fontSize: i === activeLrc ? 15 : 13, transition: "all 200ms" }}>
              {l.replace(/\[[^\]]*\]/g, "")}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// —— 视频预览（F-17：asset 协议直出、画幅自适应、倍速）——
const VideoPre: React.FC<{ path: string }> = ({ path }) => {
  const [meta, setMeta] = useState<MediaMeta | null>(null);
  const rateRef = useRef<HTMLVideoElement>(null);
  useEffect(() => { api.previewMediaMeta(path).then(setMeta).catch(() => {}); }, [path]);
  const url = useMemo(() => convertFileSrc(path), [path]);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#000" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {useAssetProbe(url) === "fail"
          ? <MediaFail path={path} name={path.split(/[\\/]/).pop() ?? ""} />
          : <video src={url} controls autoPlay style={{ maxWidth: "100%", maxHeight: "100%" }} ref={rateRef} />}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", background: "var(--ff-bg-card)", borderTop: "1px solid var(--ff-border)", fontSize: 12, color: "var(--ff-text-secondary)" }}>
        <span>{meta?.codec?.toUpperCase()} {meta?.width ? `${meta.width}×${meta.height}` : ""}</span>
        <span style={{ flex: 1 }} />
        <select onChange={(e) => { if (rateRef.current) rateRef.current.playbackRate = +e.target.value; }}
          style={{ background: "var(--ff-bg-card)", color: "var(--ff-text-primary)", border: "1px solid var(--ff-border)", borderRadius: 6, padding: 2, fontSize: 12 }}>
          <option value="1">1.0x</option><option value="1.5">1.5x</option><option value="2">2.0x</option>
        </select>
      </div>
    </div>
  );
};

// —— PDF 预览（WebView2 内置 PDF 引擎，asset 协议直出）——
const PdfPre: React.FC<{ path: string }> = ({ path }) => {
  const url = useMemo(() => convertFileSrc(path), [path]);
  const probe = useAssetProbe(url);
  // 父容器是普通 div，iframe 必须显式 width:100%（否则默认 300px 宽导致"窄条"）
  if (probe === "fail") return <MediaFail path={path} name={path.split(/[\\/]/).pop() ?? ""} />;
  return (
    <iframe
      src={url}
      title="pdf"
      style={{ display: "block", width: "100%", height: "100%", border: "none", background: "#525659" }}
    />
  );
};

// —— Office 只读预览（P1，docx/doc/xlsx/pptx）——
const OfficePre: React.FC<{ path: string }> = ({ path }) => {
  const [data, setData] = useState<{ kind: string; paragraphs?: string[]; docParagraphs?: { text: string; images: string[] }[]; sheets?: [string, string[][]][]; slideCount?: number; slides?: { index: number; title: string; texts: string[]; images?: string[]; bgCss?: string; bgImage?: string; bgDark?: boolean }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  useCtrlWheelZoom(scrollRef, zoom, setZoom);
  useEffect(() => { setZoom(1); }, [path]);
  useEffect(() => {
    let alive = true;
    // 看门狗：解析 20s 未返回就显式报错，绝不无限停留在"解析中"
    const t = setTimeout(() => { if (alive) setErr("解析超时（文件过大或被其他程序占用）"); }, 20000);
    api.previewOffice(path)
      .then((d) => { if (alive) { clearTimeout(t); setData(d); } })
      .catch((e) => { if (alive) { clearTimeout(t); setErr(String(e)); } });
    return () => { alive = false; clearTimeout(t); };
  }, [path]);
  if (err) return (
    <Centered>
      <div style={{ textAlign: "center", maxWidth: 520 }}>
        <div style={{ marginBottom: 10 }}>该 Office 文档无法在内置预览中解析</div>
        <div style={{ fontSize: 12, color: "var(--ff-text-disabled)", wordBreak: "break-all", marginBottom: 14, fontFamily: "monospace" }}>{err}</div>
        <button className="btn-primary" onClick={() => api.fsOpen(path)}>用系统默认程序打开</button>
      </div>
    </Centered>
  );
  if (!data) return <Centered>解析中…</Centered>;
  return (
    <div style={{ position: "relative", height: "100%" }}>
    <div ref={scrollRef} style={{ height: "100%", overflow: "auto", zoom, padding: 24, fontSize: 14, lineHeight: 1.8 }}>
      {(data.kind === "docx" || data.kind === "doc") && (data.docParagraphs ?? (data.paragraphs ?? []).map((t) => ({ text: t, images: [] }))).slice(0, MAX_DOC_PARAS).map((p, i) => (
        <div key={i}>
          {p.text && <p style={{ margin: "8px 0", whiteSpace: "pre-wrap" }}>{p.text}</p>}
          {/* 段内嵌图片（后端已解压到缓存，asset 协议直出；加载失败静默隐藏） */}
          {p.images.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "10px 0" }}>
              {p.images.map((img, j) => (
                <img
                  key={j}
                  src={convertFileSrc(img)}
                  loading="lazy"
                  alt=""
                  style={{ maxWidth: "55%", maxHeight: 340, objectFit: "contain", borderRadius: 8, border: "1px solid var(--ff-border)", background: "var(--ff-bg-app)" }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ))}
            </div>
          )}
        </div>
      ))}
      {(data.kind === "docx" || data.kind === "doc") && (data.docParagraphs ?? data.paragraphs ?? []).length > MAX_DOC_PARAS && (
        <div style={{ fontSize: 12, color: "var(--ff-text-disabled)", padding: "8px 0" }}>内容过长，仅显示前 {MAX_DOC_PARAS} 段</div>
      )}
      {data.kind === "xlsx" && (data.sheets ?? []).map(([name, rows]) => (
        <div key={name}>
          <h3 style={{ fontSize: 14 }}>
            {name} · {rows.length} 行
            {rows.length > MAX_XLSX_ROWS && <span style={{ fontSize: 12, color: "var(--ff-text-disabled)", fontWeight: 400 }}>（仅显示前 {MAX_XLSX_ROWS} 行）</span>}
          </h3>
          <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>{rows.slice(0, MAX_XLSX_ROWS).map((r, i) => (
              <tr key={i}>{r.slice(0, MAX_XLSX_COLS).map((c, j) => <td key={j} style={{ border: "1px solid var(--ff-border)", padding: "4px 10px" }}>{c}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      ))}
      {data.kind === "pptx" && (
        (data.slides ?? []).length === 0 ? (
          <Centered>未解析到幻灯片内容 · 可双击用 PowerPoint/WPS 打开</Centered>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
            {(data.slides ?? []).slice(0, MAX_SLIDES).map((s, i) => (
              <div key={s.index} style={{
                width: "min(760px, 100%)", aspectRatio: "16 / 9", flexShrink: 0,
                borderRadius: 12, padding: "26px 36px", overflow: "hidden",
                display: "flex", flexDirection: "column",
                // 该页真实背景（页→版式→母版继承解析）：背景图 > 纯色/渐变 > 默认渐变
                background: s.bgImage
                  ? `url("${convertFileSrc(s.bgImage)}") center / cover no-repeat`
                  : (s.bgCss || "linear-gradient(135deg, #16324f 0%, #1d4ed8 130%)"),
                color: s.bgImage ? "#f8fafc" : (s.bgDark === false ? "#1f2937" : "#f8fafc"),
                textShadow: s.bgImage ? "0 1px 4px rgba(0,0,0,.75)" : undefined,
                boxShadow: "0 10px 30px rgba(0,0,0,.28)",
                border: "1px solid rgba(255,255,255,.08)",
              }}>
                <div style={{ fontSize: 11, opacity: 0.65, letterSpacing: 1, marginBottom: 8 }}>
                  {i + 1} / {data.slideCount}
                </div>
                {s.title && (
                  <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.35, marginBottom: 12, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } as React.CSSProperties}>
                    {s.title}
                  </div>
                )}
                <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* 内嵌图片（后端已从 pptx 提取到缓存，asset 协议直出） */}
                  {(s.images?.length ?? 0) > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignContent: "flex-start" }}>
                      {s.images!.map((p, j) => (
                        <img
                          key={j}
                          src={convertFileSrc(p)}
                          loading="lazy"
                          alt=""
                          style={{ maxWidth: "47%", maxHeight: 200, objectFit: "contain", borderRadius: 8, background: "rgba(255,255,255,.94)", padding: 4 }}
                        />
                      ))}
                    </div>
                  )}
                  {s.texts.slice(0, 10).map((t, j) => (
                    <div key={j} style={{ display: "flex", gap: 8, marginBottom: 3 }}>
                      <span style={{ opacity: 0.55, flexShrink: 0 }}>•</span>
                      <span>{t}</span>
                    </div>
                  ))}
                  {s.texts.length > 10 && <div style={{ opacity: 0.55, fontSize: 12, marginTop: 4 }}>… 还有 {s.texts.length - 10} 条</div>}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
    <ZoomBar zoom={zoom} onChange={setZoom} />
    </div>
  );
};

// —— 旧版 Office 二进制（OLE2：.ppt/.xls）：不支持内容级解析，绝不读出乱码 ——
const OldOfficePre: React.FC<{ path: string; ext: string }> = ({ path, ext }) => {
  const label = ext === "ppt" ? "PowerPoint 97-2003 演示文稿" : "Excel 97-2003 工作簿";
  return (
    <Centered>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 14, marginBottom: 6 }}>{label}（. {ext}）暂不支持内容预览</div>
        <div style={{ fontSize: 12, color: "var(--ff-text-secondary)", marginBottom: 14 }}>旧版二进制格式，请用 Office/WPS 打开查看完整内容</div>
        <button className="btn-primary" onClick={() => api.fsOpen(path)}>用系统默认程序打开</button>
      </div>
    </Centered>
  );
};

// —— Markdown 预览（源码 ⇄ 渲染双视图）——
const MdPre: React.FC<{ path: string }> = ({ path }) => {
  const [text, setText] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"rendered" | "source">("rendered");
  const [zoom, setZoom] = useState(1);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useCtrlWheelZoom(scrollRef, zoom, setZoom);
  useEffect(() => { setZoom(1); }, [path]);
  useEffect(() => {
    let alive = true;
    setText(null);
    setLoadErr(null);
    // 看门狗：20s 未返回显式报错；二进制（BINARY_FILE）也走错误态而非空白
    const t = setTimeout(() => { if (alive) setLoadErr("Markdown 加载超时"); }, 20000);
    api.previewCode(path)
      .then((r) => {
        if (alive) {
          clearTimeout(t);
          // 超大 Markdown 同步解析会堵主线程：截断到 1MB
          setText(r.text.length > MAX_MD_CHARS ? r.text.slice(0, MAX_MD_CHARS) + "\n\n（文件过大，仅加载前 1MB）" : r.text);
        }
      })
      .catch((e) => { if (alive) { clearTimeout(t); setLoadErr(String(e)); } });
    return () => { alive = false; clearTimeout(t); };
  }, [path]);
  const html = useMemo(() => {
    if (!text) return "";
    // 本地文件预览：剥离脚本/事件属性，保留常规 Markdown 输出
    const raw = marked.parse(text, { async: false, breaks: true }) as string;
    return raw.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/ on\w+="[^"]*"/gi, "");
  }, [text]);
  // 图片解析：Markdown 里的相对路径图片（./img/x.png 等）浏览器自己解不了，
  // 渲染后统一改写为"所在目录 + 相对路径"再转 asset 协议 URL；加载失败隐藏破图
  useEffect(() => {
    if (mode !== "rendered" || !html) return;
    const el = bodyRef.current;
    if (!el) return;
    const dir = path.replace(/[\\/][^\\/]*$/, "");
    el.querySelectorAll("img").forEach((img) => {
      img.removeAttribute("srcset");
      img.style.maxWidth = "100%";
      img.style.borderRadius = "8px";
      img.style.margin = "6px 0";
      img.onerror = () => { img.style.display = "none"; };
      const raw = img.getAttribute("src") ?? "";
      if (/^(https?:|data:|blob:)/i.test(raw)) return;
      let p = raw;
      if (/^file:\/\//i.test(p)) {
        try { p = decodeURIComponent(p.replace(/^file:\/\/\//i, "")); } catch { /* 保留原样 */ }
        p = p.replace(/\//g, "\\");
      } else {
        try { p = decodeURIComponent(p); } catch { /* 含未编码 % 时保留原样 */ }
        p = p.replace(/\//g, "\\").replace(/^[\\/]+/, "");
        if (!/^[a-zA-Z]:[\\/]/.test(p)) p = dir ? `${dir}\\${p}` : p;
      }
      if (/^[a-zA-Z]:[\\/]/.test(p)) img.src = convertFileSrc(p);
    });
  }, [html, mode, path]);
  if (loadErr) return (
    <Centered>
      <div style={{ textAlign: "center" }}>
        <div style={{ marginBottom: 10 }}>{loadErr.includes("BINARY_FILE") ? "二进制文件不支持 Markdown 预览" : `Markdown 加载失败：${loadErr}`}</div>
        <button className="btn-primary" onClick={() => api.fsOpen(path)}>用系统默认程序打开</button>
      </div>
    </Centered>
  );
  if (text === null) return <Centered>加载中…</Centered>;
  return (
    <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderBottom: "1px solid var(--ff-border)", background: "var(--ff-bg-card)" }}>
        <div style={{ display: "flex", background: "var(--ff-bg-app)", borderRadius: 8, padding: 2 }}>
          {(["rendered", "source"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                border: "none", cursor: "pointer", fontSize: 12, padding: "4px 14px", borderRadius: 6,
                background: mode === m ? "var(--ff-primary)" : "transparent",
                color: mode === m ? "#fff" : "var(--ff-text-secondary)",
              }}
            >
              {m === "rendered" ? "渲染" : "源码"}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: "var(--ff-text-disabled)" }}>Markdown</span>
      </div>
      {mode === "source" ? (
        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflow: "auto", zoom, background: "var(--ff-bg-app)", padding: "16px 20px", fontFamily: "var(--ff-font-mono, 'Cascadia Code', monospace)", fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{text}</div>
      ) : (
        <div ref={bodyRef} className="md-body" style={{ flex: 1, minHeight: 0, overflow: "auto", zoom, padding: "20px 28px", fontSize: 14, lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: html }} />
      )}
      <ZoomBar zoom={zoom} onChange={setZoom} />
    </div>
  );
};

// —— 可执行文件/安装包（exe/msi…）：无预览内容，提供直接运行入口 ——
const ExePre: React.FC<{ path: string; name: string }> = ({ path, name }) => {
  const close = usePreview((s) => s.close);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    try {
      await api.fsOpen(path);
      close();
    } catch (err) {
      const { alertDialog } = await import("@/components/dialog");
      alertDialog("运行失败", String(err), "error");
    } finally {
      setRunning(false);
    }
  };
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "var(--ff-bg-app)" }}>
      <div style={{ width: 88, height: 88, borderRadius: 20, background: "var(--ff-bg-card)", border: "1px solid var(--ff-border)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 32px rgba(0,0,0,.12)" }}>
        <Icons.File size={40} />
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, maxWidth: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
        <div style={{ fontSize: 12, color: "var(--ff-text-secondary)", marginTop: 4 }}>可执行文件 / 安装程序 · 双击文件即可直接运行</div>
      </div>
      <button className="btn-primary" onClick={run} disabled={running} style={{ opacity: running ? 0.6 : 1 }}>
        {running ? "正在启动…" : "▶ 运行 / 安装"}
      </button>
    </div>
  );
};

// —— 压缩包免解压浏览（P1）——
const ArchivePre: React.FC<{ path: string }> = ({ path }) => {
  const [members, setMembers] = useState<{ name: string; size: number; compressed: number; isDir: boolean }[] | null>(null);
  const [aerr, setAerr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { if (alive) setAerr("压缩包读取超时（文件过大或被占用）"); }, 20000);
    api.fsArchiveList(path)
      .then((m) => { if (alive) { clearTimeout(t); setMembers(m); } })
      .catch((e) => { if (alive) { clearTimeout(t); setAerr(String(e)); } });
    return () => { alive = false; clearTimeout(t); };
  }, [path]);
  if (aerr) return (
    <Centered>
      <div style={{ textAlign: "center" }}>
        <div style={{ marginBottom: 10 }}>压缩包读取失败：{aerr}</div>
        <button className="btn-primary" onClick={() => api.fsOpen(path)}>用系统默认程序打开</button>
      </div>
    </Centered>
  );
  if (!members) return <Centered>读取压缩包…</Centered>;
  return (
    <div style={{ height: "100%", overflow: "auto", fontSize: 13 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr style={{ color: "var(--ff-text-secondary)", fontSize: 12, textAlign: "left" }}>
          <th style={{ padding: "8px 16px" }}>名称</th><th style={{ padding: 8 }}>大小</th><th style={{ padding: 8 }}>压缩后</th>
        </tr></thead>
        <tbody>
          {members.slice(0, MAX_ARCHIVE_MEMBERS).map((m) => (
            <tr key={m.name}>
              <td style={{ padding: "7px 16px" }}>{m.isDir ? "📁" : "📄"} {m.name}</td>
              <td style={{ padding: 8, color: "var(--ff-text-secondary)" }}>{m.isDir ? "—" : fmtSize(m.size)}</td>
              <td style={{ padding: 8, color: "var(--ff-text-secondary)" }}>{m.isDir ? "—" : fmtSize(m.compressed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {members.length > MAX_ARCHIVE_MEMBERS && (
        <div style={{ padding: "8px 16px", fontSize: 12, color: "var(--ff-text-disabled)" }}>条目过多，仅显示前 {MAX_ARCHIVE_MEMBERS} 项（共 {members.length} 项）</div>
      )}
      <div style={{ padding: "8px 16px", fontSize: 11, color: "var(--ff-text-disabled)" }}>zip/7z/rar 只读浏览 · 不解压（zip crate / sevenz-rust / unrar）</div>
    </div>
  );
};

export type { VaultItem };
