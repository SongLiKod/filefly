// Mock 后端：浏览器 dev 预览模式（非 Tauri 环境）。
// 完整模拟 Rust 命令层：虚拟文件系统、标签、搜索(拼音/语法)、保险箱、压缩包、重复文件。
import { emitLocal } from "./client";
import type {
  ArchiveMember, DuplicateGroup, EntryMeta, SearchHit, TagDef, VaultStatus,
} from "./types";

interface VNode {
  id?: number;
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
  ext: string | null;
  tags: Set<string>;
  py: string;      // 拼音全拼
  pyi: string;     // 拼音首字母（F-10）
  content?: string;
  dataUrl?: string; // 图片预览（SVG data URL）
  lrc?: string;
  children?: VNode[];
  parent?: VNode;
}

let seqId = 1;
const now = Date.now();
const day = 86400000;

function dir(name: string, parentPath: string, py = "", pyi = ""): VNode {
  const path = parentPath ? `${parentPath}\\${name}` : name;
  const n: VNode = {
    id: seqId++, name, path, isDir: true, size: 0, mtime: now - Math.floor(Math.random() * 30 * day),
    ext: null, tags: new Set(), py: py || name, pyi: pyi || name.slice(0, 4), children: [], parent: undefined,
  };
  return n;
}
function file(name: string, parent: VNode, opts: Partial<VNode> = {}): VNode {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : null;
  const n: VNode = {
    id: seqId++, name, path: `${parent.path}\\${name}`, isDir: false,
    size: opts.size ?? Math.floor(1e4 + Math.random() * 5e6), mtime: opts.mtime ?? now - Math.floor(Math.random() * 60 * day),
    ext, tags: new Set(), py: opts.py ?? name, pyi: opts.pyi ?? name.slice(0, 4),
    content: opts.content, dataUrl: opts.dataUrl, lrc: opts.lrc, parent,
  };
  parent.children!.push(n);
  return n;
}
function sub(parent: VNode, name: string, py?: string, pyi?: string): VNode {
  const d = dir(name, parent.path, py, pyi);
  d.parent = parent;
  parent.children!.push(d);
  return d;
}

function svgImage(title: string, c1: string, c2: string, w = 800, h = 600): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="50%" fill="rgba(255,255,255,.9)" font-size="42" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI">${title}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

// —— 虚拟文件系统构建 ——
const ROOTS: VNode[] = [];
const HOME = dir("C:\\Users\\demo", "");
HOME.py = "yonghujia"; HOME.pyi = "yhj";

const docs = sub(HOME, "文档", "wendang", "wd");
const images = sub(HOME, "图片", "tupian", "tp");
const music = sub(HOME, "音乐", "yinyue", "yy");
const videos = sub(HOME, "视频", "shipin", "sp");
const downloads = sub(HOME, "下载", "xiazai", "xz");
const desktop = sub(HOME, "桌面", "zhuomian", "zm");
const dRoot = dir("D:\\", "");
const bills = sub(dRoot, "票据", "piaocu", "pc");

// 文档
file("项目计划.xlsx", docs, { py: "xiangmujihua", pyi: "xmjh", mtime: now - 2 * 3600 * 1000 });
file("会议纪要.docx", docs, { py: "huiyijiyao", pyi: "hyjy", mtime: now - day });
file("FileFly需求文档.md", docs, {
  py: "fileflyxuqiwendang", pyi: "ffxqwd", mtime: now - 3 * day,
  content: "# FileFly 需求文档\n\n> Let your files fly · 让文件飞\n\n## 目标\n\n- 毫秒级搜索\n- 空格键 QuickLook 预览\n- 文件标签不丢失\n- 本地加密保险箱\n",
});
file("发票202603.pdf", docs, { py: "fapiao202603", pyi: "fp202603", tags: new Set(["工作"]) });
file("合同模板.pdf", docs, { py: "hetongmuban", pyi: "htmb" });
file("周报.xlsx", docs, { py: "zhoubao", pyi: "zb", mtime: now - 5 * day });
// 图片
file("产品截图01.png", images, { py: "chanpinjietu01", pyi: "cpjt01", size: 3_400_000, dataUrl: svgImage("产品截图 01", "#2E6BE6", "#00B8C4") });
file("猫咪.jpg", images, { py: "maomi", pyi: "mm", size: 2_100_000, dataUrl: svgImage("🐈", "#F76B15", "#FFC53D", 900, 700) });
file("团队合影.jpg", images, { py: "tuanduiheying", pyi: "tdhy", size: 5_800_000, dataUrl: svgImage("团队合影", "#8E4EC6", "#2E6BE6") });
file("风景壁纸.webp", images, { py: "fengjingbizhi", pyi: "fjbz", dataUrl: svgImage("风景壁纸", "#46A758", "#00B8C4") });
// 音乐
file("晚安曲.flac", music, {
  py: "wananqu", pyi: "waq", size: 28_000_000,
  lrc: "[00:01.00]晚安曲\n[00:04.00]夜色温柔\n[00:08.00]让文件飞\n[00:12.00]飞向明天\n",
});
file("渐进.mp3", music, { py: "jianjin", pyi: "jj", size: 6_200_000 });
file("白噪音.wav", music, { py: "baizaoyin", pyi: "bzy", size: 41_000_000 });
// 视频
file("产品演示.mp4", videos, { py: "chanpinyanshi", pyi: "cpys", size: 82_000_000 });
file("发布会片段.mkv", videos, { py: "fabuhuiqianduan", pyi: "fbhqd", size: 210_000_000, mtime: now - 10 * day });
// 下载
file("FileFlySetup.exe", downloads, { py: "fileflysetup", pyi: "ffs", size: 46_000_000 });
file("源码备份.zip", downloads, { py: "yuanmabeifen", pyi: "ymbf" });
file("大文件测试.bin", downloads, { py: "dawenjianceshi", pyi: "dwjcs", size: 160_000_000 });
// 桌面（代码文件）
file("main.ts", desktop, {
  py: "main", pyi: "main",
  content: `import { createApp } from "./app";\n\n// FileFly 入口\nconst app = createApp({\n  theme: "light",\n  dualPane: false,\n});\n\napp.mount("#root");\n\nfunction quickLook(entry: string): boolean {\n  return entry.endsWith(".png") || entry.endsWith(".ts");\n}\n\nfor (let i = 0; i < 10; i++) {\n  console.log("indexing", i);\n}\n`,
});
file("app.py", desktop, {
  py: "app", pyi: "app",
  content: `"""FileFly 缩略图管线示例"""\nfrom concurrent.futures import ThreadPoolExecutor\n\nMAX_WORKERS = 4\n\ndef make_thumb(path):\n    img = open_image(path)\n    return img.resize((256, 256))\n\nif __name__ == "__main__":\n    with ThreadPoolExecutor(MAX_WORKERS) as pool:\n        pool.map(make_thumb, paths)\n`,
});
file("README.md", desktop, {
  py: "readme", pyi: "readme",
  content: "# FileFly\n\n快如闪电、好看、带标签和保险箱的跨平台现代文件管理器。\n\n## 快捷键\n\n- Space 预览 / Esc 关闭\n- Ctrl+P 命令面板\n- Ctrl+X 剪切\n- 1~8 快速打预设色标\n",
});
// 票据
file("发票202601.pdf", bills, { py: "fapiao202601", pyi: "fp202601" });
file("发票202602.pdf", bills, { py: "fapiao202602", pyi: "fp202602" });

ROOTS.push(HOME, dRoot);

const find = (path: string): VNode | undefined => {
  if (path === HOME.path || path === HOME.name) return HOME;
  if (path === dRoot.name) return dRoot;
  const walk = (n: VNode): VNode | undefined => {
    if (n.path === path || n.path.replace(/\\/g, "/") === path.replace(/\\/g, "/")) return n;
    if (n.children) for (const c of n.children) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return undefined;
  };
  for (const r of ROOTS) {
    const hit = walk(r);
    if (hit) return hit;
  }
  return undefined;
};

const toMeta = (n: VNode): EntryMeta => ({
  name: n.name, path: n.path, isDir: n.isDir, size: n.size, mtime: n.mtime,
  ext: n.ext, hidden: false, placeholderState: "none", tags: [...n.tags],
});

// —— 标签定义（主题 §8.5 预设 8 色）——
const tagDefs: TagDef[] = [
  { name: "红", color: "#E5484D" }, { name: "橙", color: "#F76B15" },
  { name: "黄", color: "#FFC53D" }, { name: "绿", color: "#46A758" },
  { name: "青", color: "#00B8C4" }, { name: "蓝", color: "#2E6BE6" },
  { name: "紫", color: "#8E4EC6" }, { name: "灰", color: "#8B8D98" },
  { name: "工作", color: "#2E6BE6" }, { name: "发票", color: "#00B8C4" },
];
docs.children!.find((f) => f.name === "发票202603.pdf")!.tags.add("工作");
bills.children!.forEach((f) => f.tags.add("发票"));

// —— 归档规则（F-21）——
const tagRules = new Map<string, string>([["发票", "D:\\票据"]]);

// —— 最近使用 / 设置 ——
const recent: { path: string; kind: string; openedAt: number }[] = [];
const settings = new Map<string, unknown>();

// —— 保险箱 ——
const vault = {
  created: false, locked: true, hint: "", secondSet: false,
  items: [] as { id: number; name: string; src: string; addedAt: number }[],
  words: [] as string[],
};

// —— 操作 ——
function opProgress(kind: string, current: number, total: number, path: string, status: string) {
  emitLocal("fs:progress", { opId: 1, kind, current, total, currentPath: path, status });
}

function detach(n: VNode) {
  if (n.parent?.children) n.parent.children = n.parent.children.filter((c) => c !== n);
}
function attach(n: VNode, parent: VNode) {
  n.parent = parent;
  n.path = `${parent.path}\\${n.name}`;
  parent.children!.push(n);
}

async function opRun(kind: string, sources: string[], target?: string): Promise<[boolean, string]> {
  let current = 0;
  for (const src of sources) {
    const node = find(src);
    if (!node) return [false, `路径不存在: ${src}`];
    if (kind === "copy" || kind === "move") {
      const dest = find(target ?? "");
      if (!dest?.children) return [false, "目标目录无效"];
      if (kind === "move") { detach(node); attach(node, dest); }
      else {
        const copy = JSON.parse(JSON.stringify({ ...node, parent: undefined, tags: [...node.tags], children: node.children })) as VNode;
        const cloneNode = (src2: VNode, parent2: VNode): VNode => {
          const c: VNode = { ...src2, parent: parent2, tags: new Set(src2.tags), children: src2.children ? [] : undefined };
          if (src2.children) src2.children.forEach((k) => cloneNode(k, c).id = seqId++);
          c.id = seqId++;
          parent2.children!.push(c);
          return c;
        };
        cloneNode(node, dest);
      }
    } else if (kind === "delete") {
      detach(node);
    } else if (kind === "rename") {
      node.name = target ?? node.name;
      node.path = `${node.parent?.path ?? ""}\\${node.name}`;
    } else if (kind === "mkdir" && target) {
      const parent = find(target) ?? find(sources[0]);
      if (parent) sub(parent, sources[0] ?? "新建文件夹");
    } else if (kind === "newfile" && target) {
      const parent = find(target);
      if (parent) file(sources[0] ?? "新建文件.txt", parent, { content: "" });
    }
    current++;
    opProgress(kind, current, sources.length, src, "running");
  }
  opProgress(kind, sources.length, sources.length, "", "done");
  return [true, ""];
}

// —— 搜索（拼音 + 语法）——
function searchAll(query: {
  text: string; ext?: string; minSize?: number; maxSize?: number; modified?: string; tag?: string; isDir?: boolean;
}): SearchHit[] {
  const all: VNode[] = [];
  const walk = (n: VNode) => {
    all.push(n);
    n.children?.forEach(walk);
  };
  ROOTS.forEach(walk);
  const t = (query.text ?? "").trim().toLowerCase();
  const minTime = query.modified === "today" ? now - day : query.modified === "week" ? now - 7 * day
    : query.modified === "month" ? now - 30 * day : 0;
  return all
    .filter((n) => {
      if (query.isDir !== undefined && n.isDir !== query.isDir) return false;
      if (query.ext && n.ext !== query.ext) return false;
      if (query.minSize !== undefined && n.size < query.minSize) return false;
      if (query.maxSize !== undefined && n.size > query.maxSize) return false;
      if (minTime && n.mtime < minTime) return false;
      if (query.tag && !n.tags.has(query.tag)) return false;
      if (!t) return true;
      // 名称 / 拼音全拼 / 首字母匹配（F-09/F-10）
      return (
        n.name.toLowerCase().includes(t) ||
        n.py.toLowerCase().includes(t) ||
        n.pyi.toLowerCase().startsWith(t)
      );
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 500)
    .map((n) => ({ name: n.name, path: n.path, size: n.size, mtime: n.mtime, isDir: n.isDir, ext: n.ext }));
}

// —— 命令路由 ——
export async function mockHandle<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const a = args as { [k: string]: any };
  switch (cmd) {
    case "fs_list": {
      const node = find(a.path) ?? HOME;
      const entries = (node.children ?? []).map(toMeta);
      const sort = (a.sort as string) ?? "name";
      const order = (a.order as string) ?? "asc";
      const cmp: Record<string, (x: EntryMeta, y: EntryMeta) => number> = {
        name: (x, y) => x.name.localeCompare(y.name, "zh-CN"),
        size: (x, y) => x.size - y.size,
        mtime: (x, y) => x.mtime - y.mtime,
        ext: (x, y) => (x.ext ?? "").localeCompare(y.ext ?? ""),
      };
      entries.sort((x, y) => (x.isDir === y.isDir ? cmp[sort]?.(x, y) ?? 0 : x.isDir ? -1 : 1));
      if (order === "desc") entries.reverse();
      return entries as T;
    }
    case "fs_drives": {
      return [
        { name: "本地磁盘 (C:)", path: "C:\\", total: 512 * 1e9, free: 96 * 1e9, fs: "NTFS" },
        { name: "本地磁盘 (D:)", path: "D:\\", total: 2 * 1e12, free: 1.52 * 1e12, fs: "NTFS" },
      ] as T;
    }
    case "fs_special_dirs": {
      return {
        home: HOME.path,
        desktop: desktop.path,
        documents: docs.path,
        downloads: downloads.path,
        music: music.path,
        pictures: images.path,
        videos: videos.path,
      } as T;
    }
    case "fs_home_stats": {
      const counts: Record<string, number> = {};
      const walk = (n: VNode) => {
        if (!n.isDir && n.ext) {
          const cat =
            ["doc", "docx", "pdf", "txt", "md", "xlsx", "pptx"].includes(n.ext) ? "document"
            : ["jpg", "png", "webp", "gif", "jpeg", "svg", "heic"].includes(n.ext) ? "image"
            : ["mp3", "flac", "wav", "ape", "ogg", "m4a"].includes(n.ext) ? "music"
            : ["mp4", "mkv", "mov", "webm", "avi"].includes(n.ext) ? "video"
            : ["zip", "7z", "rar", "tar", "gz"].includes(n.ext) ? "archive"
            : ["exe", "msi", "dmg"].includes(n.ext) ? "installer" : "";
          if (cat) counts[cat] = (counts[cat] ?? 0) + 1;
        }
        n.children?.forEach(walk);
      };
      ROOTS.forEach(walk);
      const recentFiles = recent.slice(0, 12).map((r) => ({ path: r.path, mtime: r.openedAt }));
      return { counts, recentFiles } as T;
    }
    case "fs_recent": {
      return recent.slice(0, 50).map((r) => [r.path, r.kind, r.openedAt]) as T;
    }
    case "fs_record_recent": {
      const i = recent.findIndex((r) => r.path === a.path);
      if (i >= 0) recent.splice(i, 1);
      recent.unshift({ path: a.path, kind: (a.kind as string) ?? "file", openedAt: Date.now() });
      return undefined as T;
    }
    case "fs_operation": return opRun(a.kind, a.sources as string[], a.target) as T;
    case "fs_batch_rename": {
      const paths = a.paths as string[];
      const rule = a.rule as { mode: string; pattern?: string; replacement?: string; prefix?: string; suffix?: string; start?: number; step?: number };
      let seq = rule.start ?? 1; const step = rule.step ?? 1;
      const done: string[] = [];
      for (const p of paths) {
        const node = find(p);
        if (!node) continue;
        const ext = node.ext ? `.${node.ext}` : "";
        if (rule.mode === "sequence") node.name = `${rule.prefix ?? ""}${String(seq).padStart(4, "0")}${rule.suffix ?? ""}${ext}`;
        else if (rule.mode === "date") node.name = `${rule.prefix ?? ""}${new Date().toISOString().slice(0, 10).replace(/-/g, "")}${rule.suffix ?? ""}${ext}`;
        else if (rule.mode === "replace" && rule.pattern) node.name = node.name.replaceAll(rule.pattern, rule.replacement ?? "");
        node.path = `${node.parent?.path ?? ""}\\${node.name}`;
        seq += step;
        done.push(node.path);
      }
      return done as T;
    }
    case "fs_thumbnail": {
      const node = find(a.path);
      const url = node?.dataUrl ?? svgImage(node?.name ?? "?", "#2E6BE6", "#00B8C4", 256, 256);
      return url as T;
    }
    case "fs_open":
    case "fs_reveal":
    case "fs_open_terminal": {
      // Mock 环境（浏览器预览）没有系统 Shell，仅提示
      console.info(`[mock] fs_open/fs_reveal/fs_open_terminal:`, a.path);
      return null as T;
    }
    case "fs_trash_list": {
      // Mock：两条演示数据（真实数据由 Rust $Recycle.Bin 解析提供）
      const now = Date.now();
      return [
        { id: "mock-r1", iPath: "mock-i1", origPath: "C:\\Users\\demo\\Documents\\旧报告.docx", origName: "旧报告.docx", size: 48213, deletedAt: now - 3600_000 },
        { id: "mock-r2", iPath: "mock-i2", origPath: "C:\\Users\\demo\\Pictures\\截屏.png", origName: "截屏.png", size: 245760, deletedAt: now - 86_400_000 },
      ] as T;
    }
    case "fs_trash_restore":
    case "fs_trash_delete":
    case "fs_trash_empty": {
      return null as T;
    }
    case "fs_network_drives": {
      return [
        { name: "网络磁盘 (Z:)", path: "Z:\\", total: 4 * 1e12, free: 1.2 * 1e12, fs: "网络" },
      ] as T;
    }
    case "fs_stat": {
      const node = find(a.path);
      if (!node) throw new Error("path not found: " + a.path);
      return {
        name: node.name,
        path: node.name,
        isDir: node.children !== undefined,
        size: node.size ?? 0,
        mtime: node.mtime ?? Date.now(),
        ext: node.name.includes(".") ? node.name.split(".").pop()! : null,
        hidden: false,
        placeholderState: "none",
        tags: node.tags ?? [],
      } as T;
    }
    case "fs_archive_list": {
      const members: ArchiveMember[] = [
        { name: "src/", size: 0, compressed: 0, isDir: true },
        { name: "src/main.ts", size: 1240, compressed: 512, isDir: false },
        { name: "src/app.py", size: 860, compressed: 340, isDir: false },
        { name: "README.md", size: 460, compressed: 220, isDir: false },
        { name: "assets/logo.png", size: 20480, compressed: 18900, isDir: false },
      ];
      return members as T;
    }
    case "fs_duplicates_scan": {
      const groups: DuplicateGroup[] = [
        { size: 20480, name: "logo.png", paths: ["C:\\Users\\demo\\图片\\logo.png", "C:\\Users\\demo\\下载\\logo.png"] },
        { size: 460, name: "README.md", paths: ["C:\\Users\\demo\\桌面\\README.md", "C:\\Users\\demo\\文档\\README.md"] },
      ];
      return groups as T;
    }
    case "tag_list": return tagDefs as T;
    case "tag_set": {
      const node = find(a.path);
      if (node) node.tags = new Set(a.tags as string[]);
      return undefined as T;
    }
    case "tag_add": {
      const node = find(a.path);
      if (node) node.tags.add(a.tag);
      return undefined as T;
    }
    case "tag_remove": {
      const node = find(a.path);
      if (node) node.tags.delete(a.tag);
      return undefined as T;
    }
    case "tag_files_of": {
      const all: VNode[] = [];
      const walk = (n: VNode) => { all.push(n); n.children?.forEach(walk); };
      ROOTS.forEach(walk);
      return all.filter((n) => n.tags.has(a.tag)).map((n) => [n.path, [...n.tags]]) as T;
    }
    case "tag_archive_rule": { tagRules.set(a.tag, a.destDir); return undefined as T; }
    case "tag_apply_archive": {
      const dest = tagRules.get(a.tag);
      if (!dest) return 0 as T;
      let moved = 0;
      const destNode = find(dest) ?? sub(dRoot, dest);
      const all: VNode[] = [];
      const walk = (n: VNode) => { all.push(n); n.children?.forEach(walk); };
      ROOTS.forEach(walk);
      for (const n of all.filter((x) => x.tags.has(a.tag) && !x.isDir)) {
        detach(n); attach(n, destNode); moved++;
      }
      return moved as T;
    }
    case "tag_def_create": {
      if (tagDefs.some((d) => d.name === a.name)) throw new Error("标签已存在");
      tagDefs.push({ name: a.name, color: a.color });
      return undefined as T;
    }
    case "tag_def_rename": {
      const d = tagDefs.find((x) => x.name === a.oldName);
      if (d) d.name = a.newName;
      const walkR = (n: VNode) => { if (n.tags.has(a.oldName)) { n.tags.delete(a.oldName); n.tags.add(a.newName); } n.children?.forEach(walkR); };
      ROOTS.forEach(walkR);
      return undefined as T;
    }
    case "tag_def_delete": {
      const i = tagDefs.findIndex((x) => x.name === a.name);
      if (i >= 0) tagDefs.splice(i, 1);
      const walkD = (n: VNode) => { n.tags.delete(a.name); n.children?.forEach(walkD); };
      ROOTS.forEach(walkD);
      return undefined as T;
    }
    case "tag_def_set_color": {
      const d = tagDefs.find((x) => x.name === a.name);
      if (d) d.color = a.color;
      return undefined as T;
    }
    case "search_query": {
      const q = (a.q ?? {}) as { text: string; ext?: string; minSize?: number; maxSize?: number; modified?: string; tag?: string; isDir?: boolean };
      return searchAll(q) as T;
    }
    case "fs_category_files": {
      // Mock：按扩展名列表过滤全量节点
      const CATS: Record<string, string[]> = {
        document: ["doc", "docx", "pdf", "txt", "md", "xlsx", "pptx", "xls", "ppt", "rtf"],
        image: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "tiff"],
        music: ["mp3", "flac", "ape", "wav", "ogg", "m4a", "aac"],
        video: ["mp4", "mkv", "mov", "webm", "avi", "flv"],
        archive: ["zip", "7z", "rar", "tar", "gz"],
        installer: ["exe", "msi", "dmg", "pkg"],
      };
      const exts = CATS[a.category as string] ?? [];
      return exts.flatMap((ext) => searchAll({ text: "", ext })) as T;
    }
    case "search_status": return { ready: true, engine: "Mock FTS5" } as T;
    case "preview_code": {
      const node = find(a.path);
      const text = node?.content ?? "";
      const spans: { start: number; end: number; kind: string }[] = [];
      const kw = /\b(import|from|const|let|var|function|return|if|for|while|def|class|with|as|async|await|new)\b/g;
      let m: RegExpExecArray | null;
      while ((m = kw.exec(text))) spans.push({ start: m.index, end: m.index + m[0].length, kind: "keyword" });
      const str = /(["'`])(?:\\.|(?!\1).)*\1/g;
      while ((m = str.exec(text))) spans.push({ start: m.index, end: m.index + m[0].length, kind: "string" });
      const num = /\b\d+\b/g;
      while ((m = num.exec(text))) spans.push({ start: m.index, end: m.index + m[0].length, kind: "number" });
      return {
        language: node?.ext === "ts" ? "typescript" : node?.ext === "py" ? "python" : node?.ext === "md" ? "markdown" : "text",
        text, truncated: false, totalSize: text.length, lineCount: text.split("\n").length, highlightSpans: spans,
      } as T;
    }
    case "preview_image": {
      const node = find(a.path);
      const url = node?.dataUrl ?? svgImage(node?.name ?? "", "#2E6BE6", "#00B8C4");
      const base64 = url.split(",")[1];
      return { width: 800, height: 600, dataBase64: base64 } as T;
    }
    case "preview_exif": {
      return {
        make: "FileFly Camera", model: "FF-2026", dateTime: "2026-11-11 16:00:00",
        exposure: "1/125 s", fNumber: "f/2.8", iso: 400, focalLength: "35 mm", lens: "FF 24-70mm f/2.8",
        gpsLat: 31.2304, gpsLng: 121.4737,
      } as T;
    }
    case "preview_media_meta": {
      const node = find(a.path);
      const isVideo = node?.ext === "mp4" || node?.ext === "mkv";
      return {
        kind: isVideo ? "video" : "audio",
        durationSec: 213, bitrate: 320, sampleRate: 44100, channels: 2,
        codec: node?.ext ?? "", lossless: ["flac", "wav", "ape"].includes(node?.ext ?? ""),
        lyricsLrc: node?.lrc,
        width: isVideo ? 1920 : undefined, height: isVideo ? 1080 : undefined,
      } as T;
    }
    case "preview_pdf_page": throw new Error("PDF_PDFIUM_NOT_READY");
    case "preview_office": {
      const node = find(a.path);
      const ext = node?.ext;
      if (ext === "docx") return { kind: "docx", paragraphs: ["会议纪要 · 第 47 次", "一、评审 FileFly M1 里程碑产出。", "二、确认标签双写方案：NTFS ADS + SQLite。", "三、下周期进入 M2 搜索里程碑。"] } as T;
      if (ext === "xlsx") return { kind: "xlsx", sheets: [["Sheet1", ["项目计划", "里程碑", "负责人", "状态", "M1", "核心浏览", "张三", "完成"]]] } as T;
      if (ext === "pptx") return { kind: "pptx", slideCount: 2, slides: [
        { index: 1, title: "FileFly 架构概览", texts: ["Tauri v2 + React 18", "Rust 后端：索引 / 保险箱 / 预览"] },
        { index: 2, title: "里程碑", texts: ["M1 核心浏览", "M2 搜索增强", "M3 同步与协作"] },
      ] } as T;
      throw new Error("不支持的格式");
    }
    case "preview_cancel": return undefined as T;
    case "vault_status":
      return { created: vault.created, locked: vault.created && vault.locked, itemCount: vault.items.length, hasSecondPassword: vault.secondSet, hint: vault.hint } as T;
    case "vault_create": {
      vault.created = true; vault.locked = true;
      vault.hint = (a.hint as string) ?? "";
      vault.secondSet = !!a.secondPassword;
      vault.words = Array.from({ length: 24 }, (_, i) =>
        ["abandon", "ability", "absorb", "anchor", "angle", "animal", "apple", "april", "arcade", "arctic", "argue", "armor", "arrow", "artist", "atlas", "audio", "autumn", "beacon", "breeze", "crystal", "harbor", "nebula", "orbit", "zenith"][i]);
      return vault.words as T;
    }
    case "vault_unlock": {
      if (!vault.created) throw new Error("保险箱尚未创建");
      vault.locked = false;
      return true as T;
    }
    case "vault_recover": {
      vault.locked = false;
      return vault.words as T;
    }
    case "vault_lock": vault.locked = true; return undefined as T;
    case "vault_list": {
      if (vault.locked) throw new Error("VAULT_LOCKED");
      return vault.items.map((it) => ({ id: it.id, name: it.name, encPath: `${it.id}.ffb`, addedAt: it.addedAt })) as T;
    }
    case "vault_add": {
      let n = 0;
      const errs: string[] = [];
      for (const p of a.paths as string[]) {
        const node = find(p);
        if (!node || node.isDir) { errs.push(`${p.split(/[\\\\/]/).pop()}：仅支持文件`); continue; }
        vault.items.push({ id: vault.items.length + 1, name: node.name, src: p, addedAt: Date.now() });
        detach(node);
        n++;
      }
      return [n, errs] as T;
    }
    case "vault_remove": {
      vault.items = vault.items.filter((it) => it.id !== a.id);
      return undefined as T;
    }
    case "vault_open": {
      const it = vault.items.find((x) => x.id === a.id);
      if (!it) throw new Error("条目不存在");
      return `C:\\Users\\demo\\Downloads\\${it.name}.export` as T;
    }
    case "vault_verify_second": return true as T;
    case "vault_set_second": return undefined as T;
    case "vault_change_password": {
      if (!vault.created) throw new Error("保险箱尚未创建");
      if (vault.locked) throw new Error("VAULT_LOCKED");
      return vault.items.length as T;
    }
    case "settings_get": return (settings.get(a.key) ?? null) as T;
    case "settings_set": settings.set(a.key, a.value); return undefined as T;
    default:
      throw new Error(`Mock 未实现命令: ${cmd}`);
  }
}

export { HOME as MOCK_HOME };
