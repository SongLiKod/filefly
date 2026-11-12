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
  /** 按 tabId 定向导航（keep-alive 多实例：后台 tab 的面板内部跳转不打扰激活 tab） */
  navigateTab: (tabId: string, path: string, title?: string) => void;
  backTab: (tabId: string) => void;
  forwardTab: (tabId: string) => void;
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

// ---- 会话持久化（F-04 记住会话）：标签页路径/历史 + 双栏模式存 localStorage ----
const TABS_KEY = "ff-tabs-session";
interface SavedTab { path: string; title?: string; history?: string[]; historyIndex?: number }
interface SavedSession { tabs: SavedTab[]; active: number; rightTabs: SavedTab[]; rightActive: number; dualPane?: boolean }

function loadSession(): { tabs: Tab[]; activeIndex: number; rightTabs: Tab[]; rightActiveIndex: number; dualPane: boolean } | null {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedSession;
    if (!Array.isArray(s.tabs) || s.tabs.length === 0) return null;
    const revive = (t: SavedTab): Tab => {
      const history = Array.isArray(t.history) && t.history.length > 0 ? t.history : [t.path];
      return {
        id: `t-${Math.random().toString(36).slice(2, 9)}`,
        title: t.title ?? t.path.split(/[\\/]/).filter(Boolean).pop() ?? "首页",
        path: t.path,
        history,
        historyIndex: Math.min(Math.max(t.historyIndex ?? 0, 0), history.length - 1),
      };
    };
    return {
      tabs: s.tabs.map(revive),
      activeIndex: Math.min(Math.max(s.active ?? 0, 0), s.tabs.length - 1),
      rightTabs: Array.isArray(s.rightTabs) && s.rightTabs.length > 0 ? s.rightTabs.map(revive) : [mkTab(HOME_PATH)],
      rightActiveIndex: Math.min(Math.max(s.rightActive ?? 0, 0), (s.rightTabs?.length ?? 1) - 1),
      dualPane: !!s.dualPane,
    };
  } catch { return null; }
}

function saveSession() {
  const s = useTabs.getState();
  const dump = (tabs: Tab[], activeId: string) => ({
    tabs: tabs.map((t) => ({ path: t.path, title: t.title, history: t.history, historyIndex: t.historyIndex })),
    active: Math.max(0, tabs.findIndex((t) => t.id === activeId)),
  });
  const left = dump(s.tabs, s.activeTabId);
  const right = dump(s.rightTabs, s.rightActiveTabId);
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify({ ...left, rightTabs: right.tabs, rightActive: right.active, dualPane: s.dualPane }));
  } catch { /* 存储满等异常静默 */ }
}

/** 用真实用户目录替换占位路径，并同步已打开的占位标签页 */
export function setHomePath(p: string) {
  if (!p || p === HOME_PATH) return;
  const old = HOME_PATH;
  HOME_PATH = p;
  const titleOf = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? "首页";
  const fix = (t: Tab): Tab => (t.path === old ? { ...t, path: p, title: titleOf(p) } : t);
  useTabs.setState((s) => ({ tabs: s.tabs.map(fix), rightTabs: s.rightTabs.map(fix) }));
}

// 启动时恢复上次会话（只解析一次，保证 tabs/双栏状态一致）
const restoredSession = loadSession();

export const useTabs = create<TabsState>((set, get) => ({
  tabs: restoredSession?.tabs ?? [mkTab(HOME_PATH)],
  activeTabId: "",
  dualPane: restoredSession?.dualPane ?? false,
  rightTabs: restoredSession?.rightTabs ?? [mkTab(HOME_PATH)],
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
  navigateTab: (tabId, path, title) =>
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
      return { tabs: s.tabs.map((t) => (t.id === tabId ? upd(t) : t)) };
    }),
  backTab: (tabId) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.historyIndex > 0
          ? { ...t, historyIndex: t.historyIndex - 1, path: t.history[t.historyIndex - 1] }
          : t,
      ),
    })),
  forwardTab: (tabId) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.historyIndex < t.history.length - 1
          ? { ...t, historyIndex: t.historyIndex + 1, path: t.history[t.historyIndex + 1] }
          : t,
      ),
    })),
}));

// 初始化 activeTabId（若有会话恢复则指向保存时的活动标签）
if (!useTabs.getState().activeTabId) {
  useTabs.setState({
    activeTabId: useTabs.getState().tabs[restoredSession?.activeIndex ?? 0].id,
    rightActiveTabId: useTabs.getState().rightTabs[restoredSession?.rightActiveIndex ?? 0].id,
  });
}

// 任何标签页/双栏状态变化都落盘（数据量小，无需防抖）
useTabs.subscribe(saveSession);

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
