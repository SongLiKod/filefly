// QuickLook 预览状态（F-13：空格开、Esc 关、←→ 切文件）
import { create } from "zustand";

interface PreviewState {
  open: boolean;
  paths: string[];
  index: number;
  show: (paths: string[], index: number) => void;
  close: () => void;
  step: (delta: number) => void;
}

export const usePreview = create<PreviewState>((set, get) => ({
  open: false,
  paths: [],
  index: 0,
  show: (paths, index) => set({ open: true, paths, index }),
  close: () => set({ open: false }),
  step: (delta) => {
    const { paths, index } = get();
    if (paths.length === 0) return;
    const next = Math.min(paths.length - 1, Math.max(0, index + delta));
    set({ index: next });
  },
}));
