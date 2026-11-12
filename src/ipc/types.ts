// FileFly IPC 类型契约（与 src-tauri serde camelCase 一一对应）
export interface EntryMeta {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
  ext: string | null;
  hidden: boolean;
  placeholderState: "none" | "online_only" | "partial" | "pinned";
  tags: string[];
}

export interface DriveInfo {
  name: string;
  path: string;
  total: number;
  free: number;
  fs: string;
}

/** 真实用户目录（SHGetKnownFolderPath，fs_special_dirs 返回） */
export interface SpecialDirs {
  home: string;
  desktop: string;
  documents: string;
  downloads: string;
  music: string;
  pictures: string;
  videos: string;
}

export interface RecentFile {
  path: string;
  mtime: number;
}

export interface HomeStats {
  counts: Record<string, number>;
  recentFiles: RecentFile[];
}

export interface TagDef {
  name: string;
  color: string;
}

export interface SearchHit {
  name: string;
  path: string;
  size: number;
  mtime: number;
  isDir: boolean;
  ext: string | null;
}

export interface QueryInput {
  text: string;
  ext?: string;
  minSize?: number;
  maxSize?: number;
  modified?: "today" | "week" | "month";
  tag?: string;
  isDir?: boolean;
}

export interface HighlightSpan {
  start: number;
  end: number;
  kind: string;
}

export interface CodePreview {
  language: string;
  text: string;
  truncated: boolean;
  totalSize: number;
  lineCount: number;
  highlightSpans: HighlightSpan[];
}

export interface ImagePreview {
  width: number;
  height: number;
  dataBase64: string;
}

export interface ExifData {
  make?: string;
  model?: string;
  dateTime?: string;
  exposure?: string;
  fNumber?: string;
  iso?: number;
  focalLength?: string;
  lens?: string;
  gpsLat?: number;
  gpsLng?: number;
}

export interface MediaMeta {
  kind: "audio" | "video";
  durationSec: number;
  bitrate: number;
  sampleRate: number;
  channels: number;
  codec: string;
  lossless: boolean;
  coverBase64?: string;
  lyricsLrc?: string;
  width?: number;
  height?: number;
}

export interface VaultStatus {
  created: boolean;
  locked: boolean;
  itemCount: number;
  hasSecondPassword: boolean;
  hint: string;
}

export interface VaultItem {
  id: number;
  name: string;
  encPath: string;
  addedAt: number;
  /** 原始位置（0.1.9 起存入的条目才有；旧条目为 null，无法自动还原） */
  origPath: string | null;
}

export interface ArchiveMember {
  name: string;
  size: number;
  compressed: number;
  isDir: boolean;
}

export interface DuplicateGroup {
  size: number;
  name: string;
  paths: string[];
}

/** 回收站项目（fs_trash_list，$Recycle.Bin $I/$R 真实解析） */
export interface TrashItem {
  id: string;       // $R 内容文件路径（唯一标识）
  iPath: string;    // $I 元数据文件路径
  origPath: string; // 原始完整路径
  origName: string;
  size: number;
  deletedAt: number; // Unix ms
}

export interface RenameRule {
  mode: "sequence" | "date" | "replace";
  pattern?: string;
  replacement?: string;
  prefix?: string;
  suffix?: string;
  start?: number;
  step?: number;
  useRegex?: boolean;
}

export interface OpProgress {
  opId: number;
  kind: string;
  current: number;
  total: number;
  currentPath: string;
  status: "running" | "done" | "conflict" | "error" | "cancelled";
}

/** 虚拟化列表数据源：前端永不一次性持有 >2000 条完整记录（技术文档 §3） */
export const PAGE_SIZE = 500;

export function fmtSize(n: number): string {
  if (n === 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function fmtDate(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
