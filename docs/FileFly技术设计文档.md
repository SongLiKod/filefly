# FileFly · 技术设计与落地开发文档

> 版本：v1.0
> 日期：2026-11-11
> 定位：《文件管理器开发需求文档》的配套技术实现方案，目标是可以直接照此开工。
> 口号：Let your files fly · 让文件飞

---

## 1. 总体技术选型

| 层级 | 选型 | 版本基线 | 选择理由 |
|------|------|---------|---------|
| 核心引擎（后端） | **Rust**（stable，edition 2021） | rustc ≥ 1.80 | 毫秒级性能、内存安全；枚举/索引/缩略图/加密全部跑在 Rust 侧 |
| 应用框架 | **Tauri v2** | tauri ≥ 2.x | 体积小（安装包可控制在 15~30MB）、跨平台（Win/macOS）、前端生态复用、官方支持自定义协议与原生能力插件 |
| 前端 UI | **React 18 + TypeScript 5** | react ≥ 18.3 | 生态成熟、虚拟列表方案多、团队好招人 |
| 状态管理 | **Zustand** | ≥ 4.x | 轻量、适合文件树/标签/搜索状态这类中型状态量 |
| 构建工具 | **Vite 5** | ≥ 5.x | 快速 HMR，Tauri 官方推荐 |
| UI 基础组件 | **Radix UI（无头组件）+ 自研样式系统** | — | 自由控制视觉（本文第 8 节主题色），避免被现成组件库风格绑死 |
| 样式方案 | **Tailwind CSS 3 + CSS Variables 主题令牌** | ≥ 3.4 | 主题切换 = 切换一组 CSS 变量，零重建 |
| 虚拟列表 | **@tanstack/react-virtual** | ≥ 3.x | 10 万+ 行 60fps 滚动的关键 |
| 本地数据库 | **SQLite（rusqlite）+ FTS5** | ≥ 3.45 | 标签库、搜索索引、最近使用、设置；FTS5 提供毫秒级全文检索 |
| 代码高亮 | **Tree-sitter（Rust 侧解析）+ Shiki（前端渲染）** | — | 全语言高亮、准确、增量解析快 |
| 图片解码 | **Rust: image / jpeg-turbo / libvips（可选）→ RGBA → wgpu 纹理** | — | 毫秒级解码与缩放 |
| 音视频 | **ffmpeg 6（libavcodec 静态链接）+ Windows Media Foundation / macOS VideoToolbox 硬解** | — | 无损音频（FLAC/APE/WAV）与视频秒开 |
| 压缩 | **zip / sevenz-rust / unrar**（只读浏览） | — | 压缩包免解压浏览 |
| 加密 | **AES-256-GCM（ring 或 RustCrypto aes-gcm）+ Argon2id（argon2 crate）** | — | 保险箱与密码派生，不用自造轮子 |
| 文件监听 | Windows: **USN Journal（Change Journal）**；macOS: **FSEvents** | — | 增量索引零轮询 |
| 进程间通信 | Tauri IPC（`invoke`）+ 自定义协议 `ff://`（缩略图/预览流） | — | 二进制大对象走协议流，不走 JSON IPC |

**语言清单（明确到角色）**
- **Rust**：文件枚举、USN/FSEvents 索引、缩略图管线、预览解码、加密保险箱、SQLite、NTFS ADS 读写 —— `src-tauri/`
- **TypeScript**：全部 UI、视图状态、IPC 调用层、主题令牌 —— `src/`
- **CSS（Tailwind + 变量）**：主题与视觉系统
- **Shell/PowerShell（仅 CI）**：构建、签名、打包脚本

---

## 2. 工程结构

```
filefly/
├─ src-tauri/                     # Rust 核心
│  ├─ src/
│  │  ├─ main.rs                  # 入口
│  │  ├─ commands/                # Tauri command 层（fs/tag/search/preview/vault/settings）
│  │  ├─ fs/
│  │  │  ├─ enumerate.rs          # 目录枚举（Readdir + 序数排序，异步分批返回）
│  │  │  ├─ ops.rs                # 复制/剪切/删除/重命名（带进度回调与冲突策略）
│  │  │  └─ shell.rs              # 系统右键菜单、回收站（IShellItem / trash crate）
│  │  ├─ index/
│  │  │  ├─ scanner.rs            # 全盘扫描（MFT 快速枚举 + 增量 USN 处理）
│  │  │  ├─ usn.rs                # USN Journal 增量监听（Windows）
│  │  │  ├─ fsevents.rs           # FSEvents 监听（macOS）
│  │  │  └─ db.rs                 # SQLite + FTS5 schema 与查询计划
│  │  ├─ tags/
│  │  │  ├─ ads.rs                # NTFS Alternate Data Stream 读写（FileFly.Tag:*）
│  │  │  └─ store.rs              # SQLite 双写与合并
│  │  ├─ preview/
│  │  │  ├─ image.rs              # 解码/EXIF/缩放
│  │  │  ├─ code.rs               # Tree-sitter 高亮为 Token 流
│  │  │  ├─ media.rs              # ffmpeg 解码、硬解管线
│  │  │  └─ office.rs             # PDF P0；docx/xlsx/pptx 只读渲染（P1）
│  │  ├─ vault/
│  │  │  ├─ crypto.rs             # AES-256-GCM 加解密、Argon2id 派生
│  │  │  └─ box.rs                # 保险箱目录管理、锁定状态机
│  │  └─ thumbs.rs                # 缩略图生成与磁盘缓存（~/.filefly/thumbcache）
│  ├─ Cargo.toml
│  └─ tauri.conf.json
├─ src/                           # React 前端
│  ├─ app/                        # 窗口、路由、窗口布局
│  ├─ features/
│  │  ├─ browser/                 # 文件浏览（列表/宫格/详情列）
│  │  ├─ tabs/                    # 多标签页
│  │  ├─ dualpane/                # 双栏
│  │  ├─ search/                  # 搜索与语法解析
│  │  ├─ preview/                 # QuickLook 预览层
│  │  ├─ tags/                    # 标签 UI
│  │  ├─ vault/                   # 保险箱 UI
│  │  ├─ home/                    # 智能首页
│  │  └─ settings/
│  ├─ theme/                      # 主题令牌（第 8 节）tokens.css、ThemeProvider
│  ├─ ipc/                        # invoke 封装 + 类型生成（tauri-specta）
│  └─ styles/
├─ packages/
│  └─ theme-tokens/               # 令牌 JSON 单一来源（生成 CSS 与 Rust 常量）
├─ scripts/                       # CI/打包/签名
└─ docs/
```

---

## 3. 核心架构：进程与线程模型

```
┌────────────── 主进程（Rust, tokio 多线程运行时）──────────────┐
│  线程池分工：                                                  │
│  · UI 线程        仅接收轻量 IPC 结果（元数据 JSON，分批 ≤ 500 条）│
│  · IO 池          枚举/复制/删除（rayon + tokio blocking）      │
│  · 索引线程        全盘扫描 + USN/FSEvents 常驻监听             │
│  · 缩略图池        4 并发（可配置），LRU 内存缓存 + 磁盘缓存      │
│  · 预览会话        每次空格预览一个会话，Esc 即 cancel           │
└──────────────┬───────────────────────────────────────────────┘
               │ Tauri IPC (invoke / event) + ff:// 协议流
┌──────────────┴───────────────────────────────────────────────┐
│  WebView 前端：React 虚拟列表 + 状态分片（Zustand）             │
│  规则：前端永不一次性持有 >2000 条完整文件记录，其余走游标分页     │
└──────────────────────────────────────────────────────────────┘
```

关键纪律（规避竞品"卡顿"缺点的硬性约束）：
1. UI 线程 0 阻塞调用：所有 Rust command 返回 `Promise`，禁止同步等待；
2. 枚举分批：目录枚举按 300 条/批 event 推送，前端渐进渲染；
3. 缩略图/预览解码永远不在 UI 线程；结果经 `ff://thumb/{hash}?v={mtime}` 缓存 URL；
4. 预览可取消：切换选中即取消上一个解码任务（cancellation token）。

---

## 4. 搜索子系统（毫秒级全盘检索）

### 4.1 索引存储
- 每卷一张 FTS5 表 + 元数据表：

```sql
CREATE TABLE files(
  volume_id INTEGER NOT NULL,
  frn       INTEGER NOT NULL,            -- NTFS File Reference Number
  parent_frn INTEGER NOT NULL,
  name      TEXT NOT NULL,
  name_py   TEXT NOT NULL,               -- 拼音全拼（含无声调）
  name_py_initial TEXT NOT NULL,         -- 拼音首字母
  ext       TEXT,
  size      INTEGER,
  mtime     INTEGER,
  is_dir    INTEGER
);
CREATE VIRTUAL TABLE files_fts USING fts5(name, name_py, name_py_initial, content='files', content_rowid='rowid');
```

### 4.2 增量
- Windows：扫描期用 MFT 直读（类似 Everything 思路）建全量；常驻读 USN Journal，`REASON` 过滤 rename/new/delete，延迟 ≤1s 合并入库；
- macOS：FSEvents 事件 → 受影响目录局部重扫；
- exFAT/网络盘：降级为定时目录树轮询（60s，可配置）。

### 4.3 查询语法
```
xj              → 首字母/拼音匹配 "项目计划.xlsx"
计划 size:>100MB ext:pdf modified:today tag:工作
```
解析器：前端 Lexer → 结构化 Query AST → Rust 侧生成 SQL（FTS5 MATCH + WHERE 组合），EXPLAIN 强制走索引；目标百万文件 P99 ≤ 100ms。

---

## 5. 标签系统（吸收 NanoFile ADS 方案并修复短板）

### 5.1 双写持久化
- **NTFS 卷**：写入 ADS 流 `filename.xlsx:FileFly.Tags`，内容 JSON：
  ```json
  {"v":1,"tags":["工作","红色"],"mtime_check":172...}
  ```
- **非 NTFS（exFAT/网络/压缩包内）**：SQLite 库按 `(volume, canonical_path, size, mtime)` 记录；
- **合并规则**：读取时 ADS 优先；路径不存在但指纹（size+mtime+名称哈希）匹配 SQLite 记录 → 视为移动，自动迁移；双处冲突取并集。

### 5.2 跨路径聚合
侧边栏标签入口 = 按标签查询 SQLite + NTFS MFT 扫描 ADS，两路结果合并去重（frn/指纹），支持"按标签归档规则"（如 `tag:发票 → 自动入 D:/票据/`）。

---

## 6. 预览子系统（空格键 QuickLook）

| 类型 | 管线 | 打开预算 |
|------|------|---------|
| 图片 | Rust 解码（jpeg-turbo/png/image-webp）→ 缩放 → `ff://` 返回 RGBA 或编码 WebP；EXIF 侧道解析（kamadak-exif） | ≤ 300ms |
| 代码/文本 | 流式读前 5MB；Tree-sitter 出 token 流 → 前端 Shiki 渲染（行号、 minimap P2） | ≤ 300ms |
| 音频 | ffmpeg 解封装 → WAV/PCM 管道播（rodoku/cpal），FLAC/APE 直接解码；封面+LRC 从 ID3/FLAC tags 提取 | ≤ 500ms |
| 视频 | MF/VideoToolbox 硬解优先；容器 mp4/mkv/mov/webm；首帧 Pixmap → `ff://` 贴图，声音走 cpal | ≤ 1s |
| PDF | pdfium-render 渲染页位图 | ≤ 500ms |
| Office（P1） | docx/xlsx → 结构化解析渲染只读 HTML 模型；pptx → 页面位图（可借 LibreOffice core 后续评估） | P1 不设硬预算 |

预览 UI 复用 NanoFile 验证过的交互：空格开、Esc 关、←→ 切文件、底部缩略条（图片）、EXIF 面板右侧抽屉。

---

## 7. 保险箱（本地加密）

- 密码学参数：
  - KDF：**Argon2id**，`m=64MB, t=3, p=4`（可配置），盐 16B 随机；
  - 对称：**AES-256-GCM**，每文件独立 12B nonce（随机），密文格式 `[magic FFVB1][salt][nonce][ciphertext][tag]`；
  - 主密码校验值：KDF 输出再 SHA-256 截断存储（防误输），第二道密码可选；
- 运行模型：解锁后密钥仅驻内存（mlock）；保险箱文件在磁盘上始终为密文，浏览走解密流（虚拟目录）；
- 找回：生成 24 词恢复密钥（BIP39 词表），仅创建时展示一次——明确产品边界"无法暴力找回"。

---

## 8. 主题与颜色系统（详细规范）

### 8.1 设计基调
- 整体跟随 **Windows 11 Fluent / macOS 质感**：浅色为默认，深色可选；圆角 8px；亚克力/毛玻璃用于侧边栏与预览蒙层（`backdrop-filter: blur(24px) saturate(1.4)`）；
- 主色定为 **"Fly Blue"（飞行蓝）**——比 Fluent 默认蓝更亮一档，传达"轻、快"；辅助强调色为"Tag Cyan"。

### 8.2 基础色板（Core Palette）

| 令牌 | 浅色 | 深色 | 用途 |
|------|------|------|------|
| `--ff-primary` | `#2E6BE6` | `#4C8DFF` | 主操作、选中态、焦点环 |
| `--ff-primary-hover` | `#1F5AD1` | `#3D7BE8` | 按钮 hover |
| `--ff-primary-active` | `#1749B8` | `#2E66C9` | 按钮按下 |
| `--ff-accent` | `#00B8C4` | `#22D3D9` | 标签/进度/次要强调 |
| `--ff-success` | `#1F9D55` | `#2ECC71` | 完成、可用空间充足 |
| `--ff-warning` | `#D97706` | `#F59E0B` | 磁盘 70%+ 警示 |
| `--ff-danger` | `#DC2626` | `#EF4444` | 删除、磁盘 90%+、错误 |

### 8.3 中性色 / 表面（Neutral & Surface）

| 令牌 | 浅色 | 深色 | 用途 |
|------|------|------|------|
| `--ff-bg-app` | `#F5F7FA` | `#121417` | 应用底色 |
| `--ff-bg-sidebar` | `rgba(245,247,250,.78)`（毛玻璃） | `rgba(18,20,23,.78)` | 侧边栏 |
| `--ff-bg-content` | `#FFFFFF` | `#1B1E23` | 文件区 |
| `--ff-bg-card` | `#FFFFFF` | `#23262C` | 卡片（首页分类块） |
| `--ff-bg-hover` | `rgba(46,107,230,.08)` | `rgba(76,141,255,.10)` | 行悬停 |
| `--ff-bg-selected` | `rgba(46,107,230,.14)` | `rgba(76,141,255,.18)` | 行选中 |
| `--ff-border` | `#E2E6EC` | `#2E3238` | 分隔线/描边 |
| `--ff-text-primary` | `#1A1D22` | `#E8EAED` | 正文 |
| `--ff-text-secondary` | `#5B6470` | `#9AA3AE` | 次要文字 |
| `--ff-text-disabled` | `#A6ADB6` | `#5F6771` | 禁用 |
| `--ff-highlight`（搜索命中） | `#FFE58F`（底） | `#8A6D00`（底）+白字 | 关键词高亮 |

### 8.4 分类色（首页智能文件夹/文件类型，浅色底+深色图标，深色反转）

| 分类 | 图标色 | 卡片底(浅) | 卡片底(深) |
|------|--------|-----------|-----------|
| 文档 | `#2E6BE6` | `#EDF3FE` | `rgba(46,107,230,.16)` |
| 图片 | `#16A34A` | `#EAF7EF` | `rgba(22,163,74,.16)` |
| 音乐 | `#D946EF` | `#FBEFFC` | `rgba(217,70,239,.16)` |
| 视频 | `#7C3AED` | `#F3EEFC` | `rgba(124,58,237,.16)` |
| 压缩包 | `#D97706` | `#FDF4E7` | `rgba(217,119,6,.16)` |
| 安装包 | `#EA580C` | `#FDF0E9` | `rgba(234,88,12,.16)` |

### 8.5 标签预设色（8 色，与 macOS 标签可对照）

`红 #E5484D` · `橙 #F76B15` · `黄 #FFC53D` · `绿 #46A758` · `青 #00B8C4` · `蓝 #2E6BE6` · `紫 #8E4EC6` · `灰 #8B8D98`

### 8.6 图表/磁盘条渐变
- 磁盘用量条：`<70%` 用 `--ff-accent` 实色；`70~89%` 用 `--ff-warning`；`≥90%` 用 `--ff-danger`；
- Logo/启动页渐变：`linear-gradient(135deg, #2E6BE6 0%, #00B8C4 100%)`。

### 8.7 主题工程化
- 令牌单一来源：`packages/theme-tokens/tokens.json` → 脚本生成 `tokens.css`（CSS 变量）与 `tokens.rs`（Rust 侧窗口底色用，避免启动闪白）；
- 切换：`<html data-theme="light|dark">` + `prefers-color-scheme` 跟随系统，切换动画 150ms；
- 对比度：所有文字/背景组合须过 WCAG AA（正文 ≥ 4.5:1，大字 ≥ 3:1）——上表组合已按此校准；
- 字体：Windows 用系统默认 `Segoe UI Variable`，macOS 用 `SF Pro`；等宽预览用 `Cascadia Code`/`SF Mono`；中文回退 `Microsoft YaHei UI` / `PingFang SC`。

---

## 9. 关键交互规格（直接可开发）

| 交互 | 规格 |
|------|------|
| 空格预览 | 选中态按下 Space → 300ms 内浮层出现（scale .96→1 + fade 120ms） |
| 搜索 | `Ctrl+P` 唤起命令面板；`Ctrl+F` 聚焦当前栏搜索框；输入 80ms 防抖 |
| 标签 | 拖文件至侧栏标签 = 打标；行内右键 → 标签子菜单（8 色);数字键 1~8 快速打预设色标 |
| 双栏 | `Ctrl+Shift+D` 切换；Tab 在两栏间焦点切换 |
| 剪切 | `Ctrl+X` 置灰半透明显示待剪项，粘贴时执行移动（解决 Finder 无剪切的痛点） |
| 保险箱 | 入口点击 → 全屏遮罩 + 解锁卡（同 NanoFile 布局，配 Fly Blue 主按钮） |

---

## 10. 性能预算与验收口径

| 指标 | 预算 | 测量方式 |
|------|------|---------|
| 冷启动到首屏可交互 | ≤ 1.5s（Win11 i5/16GB 基准机） | Tauri `ready` 事件 + 前端 first paint |
| 10 万项目录滚动 | 60fps，无可感知掉帧 | DevTools performance + Windows 自带 FPS 计数 |
| 全盘搜索 P99 | ≤ 100ms（百万文件库） | Rust 侧埋点上报本地统计 |
| 缩略图首屏 | ≤ 500ms（100 张混合图） | 首屏 100 项缩略图完成时间 |
| 图片预览打开 | ≤ 300ms（20MP JPEG） | 命令耗时埋点 |
| 视频起播 | ≤ 1s（H.264 1080p 本地文件） | 解码首帧耗时 |
| 安装包 | Windows ≤ 80MB / macOS ≤ 90MB（含 ffmpeg 裁剪版） | 打包产物 |
| 崩溃率 | < 0.1% 会话 | 本地崩溃日志（不上传内容，需用户同意后上报统计） |

---

## 11. 打包与分发

- Windows：`tauri build` → MSIX（微软商店）+ NSIS 安装包（官网直发）；代码签名 EV 证书；
- macOS：Universal 二进制（aarch64 + x86_64），Developer ID 签名 + Notarization；
- ffmpeg 采用按需裁剪（只保留所需 demuxer/decoder），控制体积与授权面（APE 解码纳入法务确认清单）；
- 自动更新：Tauri Updater + 静态 manifest（商店版本以商店为准）。

---

## 12. 开发里程碑（对齐需求文档 M1–M4）

| 里程碑 | 技术交付物 | 周期参考 |
|--------|-----------|---------|
| M1 | 工程骨架、枚举/操作/多标签/列表宫格/缩略图管线/代码图片预览/ADS+SQLite 标签双写 | 6~8 周 |
| M2 | MFT+USN 全盘索引、FTS5 查询、拼音、语法过滤、音视频/PDF 预览 | 6 周 |
| M3 | 保险箱（Argon2id+AES-GCM）、聚合视图、双栏、批量重命名、压缩包浏览 | 5 周 |
| M4 | macOS 适配（FSEvents、Finder 集成边界、公证）、主题令牌完善、上架 | 6 周 |

---

## 13. 风险清单（技术视角）

1. **MFT 直读**需管理员权限或服务提权——MVP 先用普通枚举 + USN，M2 再评估提权体验；
2. **ffmpeg 授权/体积**：需裁剪配置固化在 CI，APE 支持上线前过法务；
3. **WebView 性能上限**：虚拟列表抖动、字体渲染差异——关键路径留 Rust 侧原生绘制备选方案（预览浮层可原生窗口）；
4. **Windows 商店 MSIX 对 USN 常驻监听的权限限制**需早期验证（做 spike）；
5. **ADS 与云盘占位符文件冲突**（OneDrive on-demand 文件读 ADS 会触发下载）——对占位符文件降级为仅 SQLite 记录。
