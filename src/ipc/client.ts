// invoke 封装（技术文档 §1：Tauri IPC + ff:// 协议流；浏览器 dev 模式 Mock 兜底）
import type { QueryInput, EntryMeta } from "./types";

type Listener = (payload: unknown) => void;

const listeners = new Map<string, Set<Listener>>();

export function onEvent(name: string, fn: Listener): () => void {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name)!.add(fn);
  // Tauri 模式接入 @tauri-apps/api/event（打包时由 tauri.conf 注入全局）
  const tauri = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  if (tauri) {
    // 动态导入避免浏览器模式报错
    import("./tauri-events").then((m) => m.bindTauriEvent(name, fn)).catch(() => {});
  }
  return () => listeners.get(name)?.delete(fn);
}

export function emitLocal(name: string, payload: unknown) {
  listeners.get(name)?.forEach((fn) => {
    try { fn(payload); } catch (e) { console.error(e); }
  });
}

export const isTauri = (): boolean =>
  typeof window !== "undefined" && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

export async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const fn = (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: Record<string, unknown>) => Promise<T> };
    }).__TAURI_INTERNALS__.invoke;
    return fn(cmd, args);
  }
  // 浏览器预览：Mock 后端
  const { mockHandle } = await import("./mock");
  return mockHandle<T>(cmd, args ?? {});
}

export const api = {
  fsList: async (path: string, opts?: { showHidden?: boolean; sort?: string; order?: string }) => {
    const r = await invoke<EntryMeta[] | { entries: EntryMeta[] }>("fs_list", { path, ...opts });
    return { entries: Array.isArray(r) ? r : r.entries };
  },
  fsDrives: () => invoke<import("./types").DriveInfo[]>("fs_drives"),
  fsSpecialDirs: () => invoke<import("./types").SpecialDirs>("fs_special_dirs"),
  fsStat: (path: string) => invoke<import("./types").EntryMeta>("fs_stat", { path }),
  fsDirSizes: (paths: string[]) => invoke<import("./types").DirSizeInfo[]>("fs_dir_sizes", { paths }),
  fsHomeStats: (home: string) => invoke<import("./types").HomeStats>("fs_home_stats", { home }),
  fsRecent: () => invoke<[string, string, number][]>("fs_recent"),
  fsRecentClear: () => invoke("fs_recent_clear"),
  fsRecordRecent: (path: string, kind?: string) => invoke("fs_record_recent", { path, kind }),
  fsOperation: (kind: string, sources: string[], target?: string, conflict?: string) =>
    invoke<[boolean, string]>("fs_operation", { kind, sources, target, conflict }),
  fsBatchRename: (paths: string[], rule: import("./types").RenameRule) =>
    invoke<string[]>("fs_batch_rename", { paths, rule }),
  fsThumbnail: (path: string, mtime: number) => invoke<string>("fs_thumbnail", { path, mtime }),
  fsOpen: (path: string) => invoke("fs_open", { path }),
  fsOpenTerminal: (path: string) => invoke("fs_open_terminal", { path }),
  fsReveal: (path: string) => invoke("fs_reveal", { path }),
  fsArchiveList: (path: string) => invoke<import("./types").ArchiveMember[]>("fs_archive_list", { path }),
  fsDuplicatesScan: (roots: string[], maxDepth?: number) =>
    invoke<import("./types").DuplicateGroup[]>("fs_duplicates_scan", { roots, maxDepth }),
  fsTrashList: () => invoke<import("./types").TrashItem[]>("fs_trash_list"),
  fsTrashRestore: (iPath: string) => invoke<string>("fs_trash_restore", { iPath }),
  fsTrashDelete: (id: string, iPath: string) => invoke("fs_trash_delete", { id, iPath }),
  fsTrashEmpty: () => invoke<number>("fs_trash_empty"),
  fsSpaceScan: (root: string) => invoke<import("./types").ScanResult>("fs_space_scan", { root }),
  fsSpaceCancel: () => invoke("fs_space_cancel"),
  fsCleanTargets: () => invoke<import("./types").CleanTargetsResult>("fs_clean_targets"),
  fsCleanScanCancel: () => invoke("fs_clean_targets_cancel"),
  fsCleanExecute: (ids: string[]) => invoke<import("./types").CleanReport>("fs_clean_execute", { ids }),
  fsNetworkDrives: () => invoke<import("./types").DriveInfo[]>("fs_network_drives"),
  tagList: () => invoke<import("./types").TagDef[]>("tag_list"),
  tagSet: (path: string, tags: string[]) => invoke("tag_set", { path, tags }),
  tagAdd: (path: string, tag: string) => invoke("tag_add", { path, tag }),
  tagRemove: (path: string, tag: string) => invoke("tag_remove", { path, tag }),
  tagFilesOf: (tag: string) => invoke<import("./types").TaggedPath[]>("tag_files_of", { tag }),
  tagArchiveRule: (tag: string, destDir: string) => invoke("tag_archive_rule", { tag, destDir }),
  tagApplyArchive: (tag: string) => invoke<number>("tag_apply_archive", { tag }),
  tagDefCreate: (name: string, color: string) => invoke("tag_def_create", { name, color }),
  tagDefRename: (oldName: string, newName: string) => invoke("tag_def_rename", { oldName, newName }),
  tagDefDelete: (name: string) => invoke("tag_def_delete", { name }),
  tagDefSetColor: (name: string, color: string) => invoke("tag_def_set_color", { name, color }),
  searchQuery: (q: QueryInput, limit?: number) =>
    invoke<import("./types").SearchHit[]>("search_query", { q, limit }),
  fsCategoryFiles: (category: string, home: string) =>
    invoke<import("./types").SearchHit[]>("fs_category_files", { category, home }),
  searchStatus: () => invoke<{ ready: boolean; engine: string }>("search_status"),
  previewCode: (path: string) => invoke<import("./types").CodePreview>("preview_code", { path }),
  previewImage: (path: string, maxEdge?: number) =>
    invoke<import("./types").ImagePreview>("preview_image", { path, maxEdge }),
  previewExif: (path: string) => invoke<import("./types").ExifData>("preview_exif", { path }),
  previewMediaMeta: (path: string) => invoke<import("./types").MediaMeta>("preview_media_meta", { path }),
  previewOffice: (path: string) =>
    invoke<{ kind: string; paragraphs?: string[]; docParagraphs?: { text: string; images: string[] }[]; sheets?: [string, string[][]][]; slideCount?: number; slides?: { index: number; title: string; texts: string[]; images?: string[]; bgCss?: string; bgImage?: string; bgDark?: boolean }[] }>(
      "preview_office", { path }
    ),
  vaultStatus: () => invoke<import("./types").VaultStatus>("vault_status"),
  vaultCreate: (masterPassword: string, secondPassword?: string, hint?: string) =>
    invoke<string[]>("vault_create", { masterPassword, secondPassword, hint }),
  vaultUnlock: (password: string) => invoke<boolean>("vault_unlock", { password }),
  vaultRecover: (words: string[], newPassword: string) => invoke<string[]>("vault_recover", { words, newPassword }),
  vaultLock: () => invoke("vault_lock"),
  vaultList: () => invoke<import("./types").VaultItem[]>("vault_list"),
  vaultOpen: (id: number) => invoke<string>("vault_open", { id }),
  vaultAdd: (paths: string[]) => invoke<[number, string[]]>("vault_add", { paths }),
  vaultRemove: (id: number) => invoke("vault_remove", { id }),
  vaultRestore: (id: number) => invoke<string>("vault_restore", { id }),
  vaultVerifySecond: (password: string) => invoke<boolean>("vault_verify_second", { password }),
  vaultSetSecond: (newSecond?: string) => invoke<void>("vault_set_second", { newSecond: newSecond ?? null }),
  vaultChangePassword: (oldPassword: string, newPassword: string) =>
    invoke<number>("vault_change_password", { oldPassword, newPassword }),
  settingsGet: <T>(key: string) => invoke<T | null>("settings_get", { key }),
  settingsSet: (key: string, value: unknown) => invoke("settings_set", { key, value }),
};
