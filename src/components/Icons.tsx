// 内联 SVG 图标（Fluent 风格描边图标，避免图标库依赖）
import React from "react";

const I = ({ d, size = 16, vb = "0 0 24 24", color }: { d: string; size?: number; vb?: string; color?: string }) => (
  <svg width={size} height={size} viewBox={vb} fill="none" stroke={color ?? "currentColor"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export const Icons = {
  Folder: (p: { size?: number; color?: string }) => (
    <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill={p.color ?? "var(--ff-primary)"}>
      <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
    </svg>
  ),
  File: (p: { size?: number }) => <I {...p} d="M6 2h8l4 4v16H6V2z M14 2v4h4" />,
  Image: (p: { size?: number }) => <I {...p} d="M3 5h18v14H3V5z M3 15l5-5 4 4 3-3 6 6" />,
  Music: (p: { size?: number }) => <I {...p} d="M9 18V5l10-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />,
  Video: (p: { size?: number }) => <I {...p} d="M3 6h13v12H3V6z M16 10l5-3v10l-5-3" />,
  Archive: (p: { size?: number }) => <I {...p} d="M4 4h16v16H4V4z M9 4v4h6V4 M12 11v2" />,
  Installer: (p: { size?: number }) => <I {...p} d="M12 3v12 M7 10l5 5 5-5 M4 19h16" />,
  Search: (p: { size?: number }) => <I {...p} d="M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12z M20 20l-4.5-4.5" />,
  Tag: (p: { size?: number }) => <I {...p} d="M3 12l9-9 9 9-9 9-9-9z M12 8a1 1 0 1 0 0 2 1 1 0 0 0 0-2" />,
  Lock: (p: { size?: number }) => <I {...p} d="M5 11h14v10H5V11z M8 11V7a4 4 0 0 1 8 0v4" />,
  Trash: (p: { size?: number }) => <I {...p} d="M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14" />,
  Network: (p: { size?: number }) => <I {...p} d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3c-3 3-3 15 0 18 3-3 3-15 0-18" />,
  Clock: (p: { size?: number }) => <I {...p} d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 3" />,
  Star: (p: { size?: number }) => <I {...p} d="M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8L12 3z" />,
  Home: (p: { size?: number }) => <I {...p} d="M4 11l8-7 8 7v9h-5v-6h-6v6H4v-9z" />,
  Copy: (p: { size?: number }) => <I {...p} d="M8 8h12v12H8V8z M4 16V4h12" />,
  Cut: (p: { size?: number }) => <I {...p} d="M6 4l12 14 M18 4L6 18 M7 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M17 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />,
  Paste: (p: { size?: number }) => <I {...p} d="M8 4h8v3H8V4z M5 7h14v13H5V7z" />,
  Pen: (p: { size?: number }) => <I {...p} d="M4 20l4-1L20 7l-3-3L5 16l-1 4z" />,
  Plus: (p: { size?: number }) => <I {...p} d="M12 5v14 M5 12h14" />,
  FilePlus: (p: { size?: number }) => <I {...p} d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z M14 3v5h5 M12 12v6 M9 15h6" />,
  Refresh: (p: { size?: number }) => <I {...p} d="M20 12a8 8 0 1 1-2.3-5.7 M20 4v4h-4" />,
  Back: (p: { size?: number }) => <I {...p} d="M15 5l-7 7 7 7" />,
  Forward: (p: { size?: number }) => <I {...p} d="M9 5l7 7-7 7" />,
  Up: (p: { size?: number }) => <I {...p} d="M12 19V5 M5 12l7-7 7 7" />,
  Grid: (p: { size?: number }) => <I {...p} d="M4 4h7v7H4V4z M13 4h7v7h-7V4z M4 13h7v7H4v-7z M13 13h7v7h-7v-7z" />,
  List: (p: { size?: number }) => <I {...p} d="M8 6h13 M8 12h13 M8 18h13 M4 6h1 M4 12h1 M4 18h1" />,
  Details: (p: { size?: number }) => <I {...p} d="M4 6h16 M4 12h16 M4 18h16 M8 6v12" />,
  Dual: (p: { size?: number }) => <I {...p} d="M4 5h7v14H4V5z M13 5h7v14h-7V5z" />,
  Close: (p: { size?: number }) => <I {...p} d="M6 6l12 12 M18 6L6 18" />,
  Settings: (p: { size?: number }) => <I {...p} d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 2.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.5L5.1 11a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.3-1a7 7 0 0 0 1.7 1l.4 2.5h5l.4-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.5-2-1.5c.1-.3.1-.7.1-1z" />,
  Sun: (p: { size?: number }) => <I {...p} d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z M12 2v2 M12 20v2 M4 12H2 M22 12h-2 M5 5l1.5 1.5 M17.5 17.5L19 19 M19 5l-1.5 1.5 M6.5 17.5L5 19" />,
  Moon: (p: { size?: number }) => <I {...p} d="M20 13A8 8 0 1 1 11 4a7 7 0 0 0 9 9z" />,
  Command: (p: { size?: number }) => <I {...p} d="M8 8h8v8H8V8z M8 8a2.5 2.5 0 1 0-2.5-2.5V8H8z M16 8a2.5 2.5 0 1 0 2.5-2.5V8H16z M8 16a2.5 2.5 0 1 1-2.5 2.5V16H8z M16 16a2.5 2.5 0 1 1 2.5 2.5V16H16z" />,
  Rename: (p: { size?: number }) => <I {...p} d="M4 7V4h16v3 M9 20h6 M12 4v16" />,
  Zip: (p: { size?: number }) => <I {...p} d="M4 4h16v16H4V4z M12 4v3 M12 9v2 M12 13v2 M12 17v3" />,
  Duplicate: (p: { size?: number }) => <I {...p} d="M7 7h13v13H7V7z M4 16V4h12" />,
  Play: (p: { size?: number }) => <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7V5z" /></svg>,
  Pause: (p: { size?: number }) => <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7V5z M13 5h4v14h-4V5z" /></svg>,
  ZoomIn: (p: { size?: number }) => <I {...p} d="M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12z M20 20l-4.5-4.5 M10 7v6 M7 10h6" />,
  ZoomOut: (p: { size?: number }) => <I {...p} d="M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12z M20 20l-4.5-4.5 M7 10h6" />,
  Maximize: (p: { size?: number }) => <I {...p} d="M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5" />,
  Minimize: (p: { size?: number }) => <I {...p} d="M9 4v5H4 M20 9h-5V4 M15 20v-5h5 M4 15h5v5" />,
  Disk: (p: { size?: number }) => <I {...p} d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />,
  // —— 用户目录专用图标（侧栏收藏区，配主题 8 色板）——
  DesktopDir: (p: { size?: number; color?: string }) => <I {...p} d="M3 4.5h18v11.5H3V4.5z M9 20h6 M12 16v4 M6.5 12.5l3-3 2 2 3.5-3.5 3 3" />,
  DocumentsDir: (p: { size?: number; color?: string }) => <I {...p} d="M6 3h8l5 5v13H6V3z M14 3v5h5 M9.5 12.5h5 M9.5 16h5" />,
  PicturesDir: (p: { size?: number; color?: string }) => <I {...p} d="M3 5h18v14H3V5z M9.5 8a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z M3 16.5l5.5-4.5 4 3 3.5-3.5 5 5" />,
  MusicDir: (p: { size?: number; color?: string }) => <I {...p} d="M9 17.5V5.5l11-2v11.5 M9 17.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M20 15a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />,
  VideosDir: (p: { size?: number; color?: string }) => <I {...p} d="M3 5h18v14H3V5z M10 9l5.5 3-5.5 3V9z" />,
  DownloadsDir: (p: { size?: number; color?: string }) => <I {...p} d="M12 3.5v10 M8 9.5l4 4 4-4 M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  Eye: (p: { size?: number }) => <I {...p} d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />,
  Terminal: (p: { size?: number }) => <I {...p} d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M6.5 9.5L9 12l-2.5 2.5 M11.5 15H17" />,
  Logo: (p: { size?: number }) => (
    <svg width={p.size ?? 24} height={p.size ?? 24} viewBox="0 0 24 24">
      <defs>
        <linearGradient id="fflogo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2E6BE6" />
          <stop offset="1" stopColor="#00B8C4" />
        </linearGradient>
      </defs>
      <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" fill="url(#fflogo)" />
      <path d="M13 14l5-4-5-4v2.2c-3 .3-4.6 1.8-5 4.8 1.2-1.2 2.7-1.9 5-2V14z" fill="#fff" opacity=".9" />
    </svg>
  ),
};
