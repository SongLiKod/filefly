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
  setFilter: (f: AppState["filter"]) => void;
  setSelection: (paths: string[]) => void;
  toggleSidebar: () => void;
  toggleOpen: (k: "settingsOpen" | "commandPaletteOpen" | "batchRenameOpen" | "duplicatesOpen") => void;
}

export const useApp = create<AppState>((set) => ({
  theme: (localStorage.getItem("ff-theme") as "light" | "dark") ?? "system",
  viewMode: "list",
  sortField: "name",
  sortOrder: "asc",
  showHidden: false,
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
  setViewMode: (viewMode) => set({ viewMode }),
  setSort: (sortField, sortOrder) =>
    set((s) => ({ sortField, sortOrder: sortOrder ?? (s.sortField === sortField && s.sortOrder === "asc" ? "desc" : "asc") })),
  setShowHidden: (showHidden) => set({ showHidden }),
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
