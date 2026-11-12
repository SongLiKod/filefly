// 标签状态（F-19~F-21 + 标签定义增删改）
import { create } from "zustand";
import { api } from "@/ipc/client";
import type { TagDef } from "@/ipc/types";

interface TagsState {
  defs: TagDef[];
  loaded: boolean;
  load: () => Promise<void>;
  createTag: (name: string, color: string) => Promise<void>;
  renameTag: (oldName: string, newName: string) => Promise<void>;
  deleteTag: (name: string) => Promise<void>;
  setTagColor: (name: string, color: string) => Promise<void>;
}

export const useTags = create<TagsState>((set, get) => ({
  defs: [],
  loaded: false,
  load: async () => {
    try {
      const defs = await api.tagList();
      set({ defs, loaded: true });
    } catch (e) {
      console.error("tag_list failed", e);
      set({ loaded: true });
    }
  },
  createTag: async (name, color) => {
    await api.tagDefCreate(name, color);
    await get().load();
  },
  renameTag: async (oldName, newName) => {
    await api.tagDefRename(oldName, newName);
    await get().load();
  },
  deleteTag: async (name) => {
    await api.tagDefDelete(name);
    await get().load();
  },
  setTagColor: async (name, color) => {
    await api.tagDefSetColor(name, color);
    await get().load();
  },
}));
