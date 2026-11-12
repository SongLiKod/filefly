// 多标签页状态（F-04：单窗口多标签、记住会话）+ 双栏（F-05）
import { create } from "zustand";

export interface Tab {
  id: string;
  title: string;
  path: string;
  history: string[];
  historyIndex: number;
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string;
  dualPane: boolean;
  rightTabs: Tab[];
  rightActiveTabId: string;
  addTab: (path?: string) => void;
  closeTab: (id: string) => void;
  activate: (id: string) => void;
  navigate: (path: string, title?: string) => void;
  back: () => void;
  forward: () => void;
  toggleDualPane: () => void;
  activeTab: () => Tab;
  /** 按侧导航：双栏模式下左/右栏各自独立跳转 */
  navigateIn: (side: "left" | "right", path: string, title?: string) => void;
  backIn: (side: "left" | "right") => void;
  forwardIn: (side: "left" | "right") => void;
}

const mkTab = (path: string): Tab => ({
  id: `t-${Math.random().toString(36).slice(2, 9)}`,
  title: path.split(/[\\/]/).filter(Boolean).pop() ?? "首页",
  path,
  history: [path],
  historyIndex: 0,
});

// 主目录占位：应用启动后由 fs_special_dirs 回填真实用户目录（setHomePath）
let HOME_PATH = "C:\\Users\\demo";

export { HOME_PATH };

/** 用真实用户目录替换占位路径，并同步已打开的占位标签页 */
export function setHomePath(p: string) {
  if (!p || p === HOME_PATH) return;
  const old = HOME_PATH;
  HOME_PATH = p;
  const titleOf = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? "首页";
  const fix = (t: Tab): Tab => (t.path === old ? { ...t, path: p, title: titleOf(p) } : t);
  useTabs.setState((s) => ({ tabs: s.tabs.map(fix), rightTabs: s.rightTabs.map(fix) }));
}

export const useTabs = create<TabsState>((set, get) => ({
  tabs: [mkTab(HOME_PATH)],
  activeTabId: "",
  dualPane: false,
  rightTabs: [mkTab(HOME_PATH)],
  rightActiveTabId: "",
  addTab: (path) =>
    set((s) => {
      const t = mkTab(path ?? s.activeTab().path);
      return { tabs: [...s.tabs, t], activeTabId: t.id };
    }),
  closeTab: (id) =>
    set((s) => {
      if (s.tabs.length === 1) return s;
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeTabId = s.activeTabId === id ? tabs[0].id : s.activeTabId;
      return { tabs, activeTabId };
    }),
  activate: (id) => set({ activeTabId: id }),
  navigate: (path, title) =>
    set((s) => {
      const upd = (t: Tab): Tab => {
        if (t.id !== s.activeTabId) return t;
        const history = [...t.history.slice(0, t.historyIndex + 1), path];
        return {
          ...t,
          path,
          title: title ?? path.split(/[\\/]/).filter(Boolean).pop() ?? "首页",
          history,
          historyIndex: history.length - 1,
        };
      };
      return {
        tabs: s.tabs.map(upd),
        rightTabs: s.rightTabs.map(upd),
      };
    }),
  back: () =>
    set((s) => {
      const upd = (t: Tab): Tab =>
        t.id === s.activeTabId && t.historyIndex > 0
          ? { ...t, historyIndex: t.historyIndex - 1, path: t.history[t.historyIndex - 1] }
          : t;
      return { tabs: s.tabs.map(upd), rightTabs: s.rightTabs.map(upd) };
    }),
  forward: () =>
    set((s) => {
      const upd = (t: Tab): Tab =>
        t.id === s.activeTabId && t.historyIndex < t.history.length - 1
          ? { ...t, historyIndex: t.historyIndex + 1, path: t.history[t.historyIndex + 1] }
          : t;
      return { tabs: s.tabs.map(upd), rightTabs: s.rightTabs.map(upd) };
    }),
  toggleDualPane: () => set((s) => ({ dualPane: !s.dualPane })),
  navigateIn: (side, path, title) =>
    set((s) => {
      const upd = (t: Tab): Tab => {
        const history = [...t.history.slice(0, t.historyIndex + 1), path];
        return {
          ...t,
          path,
          title: title ?? path.split(/[\\/]/).filter(Boolean).pop() ?? "首页",
          history,
          historyIndex: history.length - 1,
        };
      };
      return side === "left"
        ? { tabs: s.tabs.map((t) => (t.id === s.activeTabId ? upd(t) : t)) }
        : { rightTabs: s.rightTabs.map((t) => (t.id === s.rightActiveTabId ? upd(t) : t)) };
    }),
  backIn: (side) =>
    set((s) => {
      if (side === "left") {
        return { tabs: s.tabs.map((t) => t.id === s.activeTabId && t.historyIndex > 0
          ? { ...t, historyIndex: t.historyIndex - 1, path: t.history[t.historyIndex - 1] } : t) };
      }
      return { rightTabs: s.rightTabs.map((t) => t.id === s.rightActiveTabId && t.historyIndex > 0
        ? { ...t, historyIndex: t.historyIndex - 1, path: t.history[t.historyIndex - 1] } : t) };
    }),
  forwardIn: (side) =>
    set((s) => {
      if (side === "left") {
        return { tabs: s.tabs.map((t) => t.id === s.activeTabId && t.historyIndex < t.history.length - 1
          ? { ...t, historyIndex: t.historyIndex + 1, path: t.history[t.historyIndex + 1] } : t) };
      }
      return { rightTabs: s.rightTabs.map((t) => t.id === s.rightActiveTabId && t.historyIndex < t.history.length - 1
        ? { ...t, historyIndex: t.historyIndex + 1, path: t.history[t.historyIndex + 1] } : t) };
    }),
  activeTab: () => {
    const s = get();
    return s.tabs.find((t) => t.id === s.activeTabId) ?? s.tabs[0];
  },
}));

// 初始化 activeTabId
if (!useTabs.getState().activeTabId) {
  useTabs.setState({ activeTabId: useTabs.getState().tabs[0].id, rightActiveTabId: useTabs.getState().rightTabs[0].id });
}

/** 剪贴板（F-01 剪切：Ctrl+X 置灰半透明显示待剪项，粘贴时执行移动，技术文档 §9） */
interface ClipboardState {
  kind: "none" | "copy" | "cut";
  paths: string[];
  setClipboard: (kind: "copy" | "cut", paths: string[]) => void;
  clear: () => void;
}
export const useClipboard = create<ClipboardState>((set) => ({
  kind: "none",
  paths: [],
  setClipboard: (kind, paths) => set({ kind, paths }),
  clear: () => set({ kind: "none", paths: [] }),
}));
