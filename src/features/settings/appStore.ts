// 应用级状态：主题（F-主题/P1）、设置、排序筛选（F-08）、选中项
import { create } from "zustand";
import type { SpecialDirs } from "@/ipc/types";
import { api } from "@/ipc/client";

export type ViewMode = "list" | "grid" | "details";
export type SortField = "name" | "size" | "mtime" | "ext";
export type SortOrder = "asc" | "desc";

interface AppState {
  theme: "light" | "dark" | "system";
  viewMode: ViewMode;
  sortField: SortField;
  sortOrder: SortOrder;
  showHidden: boolean;
  folderSize: boolean; // 显示文件夹大小（后台异步计算；关闭则完全不计算）
  filter: "" | "today" | "large" | "duplicate"; // F-08 筛选器
  settingsOpen: boolean;
  commandPaletteOpen: boolean;
  batchRenameOpen: boolean;
  duplicatesOpen: boolean;
  selection: string[]; // 当前选中路径
  cutPaths: string[];
  pendingReveal: string | null; // 待定位文件：新标签打开所在文件夹后自动选中并滚动到它
  specialDirs: SpecialDirs | null; // 真实用户目录（桌面/文档/图片/音乐/视频/下载）
  sidebarCollapsed: boolean; // 左侧面板折叠/展开
  setSpecialDirs: (d: SpecialDirs) => void;
  loadSpecialDirs: () => Promise<void>;
  setPendingReveal: (p: string | null) => void;
  setTheme: (t: "light" | "dark" | "system") => void;
  setViewMode: (v: ViewMode) => void;
  setSort: (f: SortField, o?: SortOrder) => void;
  setShowHidden: (v: boolean) => void;
  setFolderSize: (v: boolean) => void;
  setFilter: (f: AppState["filter"]) => void;
  setSelection: (paths: string[]) => void;
  toggleSidebar: () => void;
  toggleOpen: (k: "settingsOpen" | "commandPaletteOpen" | "batchRenameOpen" | "duplicatesOpen") => void;
}

const VIEW_MODES: ViewMode[] = ["list", "grid", "details"];
const savedViewMode = localStorage.getItem("ff-view-mode") as ViewMode | null;
// 初始视图模式：默认"详情"，手动切换后持久化到 localStorage
const initViewMode: ViewMode = savedViewMode && VIEW_MODES.includes(savedViewMode) ? savedViewMode : "details";
// 排序/隐藏文件持久化
const SORT_FIELDS: SortField[] = ["name", "size", "mtime", "ext"];
const savedSortField = localStorage.getItem("ff-sort-field") as SortField | null;
const savedSortOrder = localStorage.getItem("ff-sort-order") as SortOrder | null;

export const useApp = create<AppState>((set) => ({
  theme: (localStorage.getItem("ff-theme") as "light" | "dark") ?? "system",
  viewMode: initViewMode,
  sortField: savedSortField && SORT_FIELDS.includes(savedSortField) ? savedSortField : "name",
  sortOrder: savedSortOrder === "desc" ? "desc" : "asc",
  showHidden: localStorage.getItem("ff-show-hidden") === "1",
  folderSize: localStorage.getItem("ff-folder-size") !== "0", // 默认开启
  filter: "",
  settingsOpen: false,
  commandPaletteOpen: false,
  batchRenameOpen: false,
  duplicatesOpen: false,
  selection: [],
  cutPaths: [],
  pendingReveal: null,
  specialDirs: null,
  sidebarCollapsed: localStorage.getItem("ff-sidebar") === "collapsed",
  setSpecialDirs: (specialDirs) => set({ specialDirs }),
  loadSpecialDirs: async () => {
    try {
      const d = await api.fsSpecialDirs();
      set({ specialDirs: d });
    } catch { /* Mock/降级时保持 null，侧栏用兜底路径 */ }
  },
  setTheme: (t) => {
    localStorage.setItem("ff-theme", t === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t);
    const effective = t === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
    document.documentElement.setAttribute("data-theme", effective);
    set({ theme: t });
  },
  setViewMode: (viewMode) => {
    localStorage.setItem("ff-view-mode", viewMode);
    set({ viewMode });
  },
  setSort: (sortField, sortOrder) =>
    set((s) => {
      const order = sortOrder ?? (s.sortField === sortField && s.sortOrder === "asc" ? "desc" : "asc");
      localStorage.setItem("ff-sort-field", sortField);
      localStorage.setItem("ff-sort-order", order);
      return { sortField, sortOrder: order };
    }),
  setShowHidden: (showHidden) => {
    localStorage.setItem("ff-show-hidden", showHidden ? "1" : "0");
    set({ showHidden });
  },
  setFolderSize: (folderSize) => {
    localStorage.setItem("ff-folder-size", folderSize ? "1" : "0");
    set({ folderSize });
  },
  setFilter: (filter) => set((s) => ({ filter: s.filter === filter ? "" : filter })),
  setSelection: (selection) => set({ selection }),
  setPendingReveal: (pendingReveal) => set({ pendingReveal }),
  toggleSidebar: () =>
    set((s) => {
      const v = !s.sidebarCollapsed;
      localStorage.setItem("ff-sidebar", v ? "collapsed" : "expanded");
      return { sidebarCollapsed: v };
    }),
  toggleOpen: (k) => set((s) => ({ [k]: !s[k] }) as Partial<AppState>),
}));
