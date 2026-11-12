// 设置页（主题/视图/行为；P1 主题系统：深浅色 + 毛玻璃）
import React, { useEffect, useState } from "react";
import { Modal } from "@/components/ui";
import { useApp, type ViewMode } from "./appStore";
import { Icons } from "@/components/Icons";
import { invoke } from "@/ipc/client";

export const SettingsPage: React.FC = () => {
  const open = useApp((s) => s.settingsOpen);
  const toggleOpen = useApp((s) => s.toggleOpen);
  const app = useApp();
  const [thumbConcurrency] = useState(4); // 缩略图池并发（可配置，技术文档 §3）

  // 开机自启动（tauri-plugin-autostart：注册表 HKCU Run 键，无需管理员）
  const [autoStart, setAutoStart] = useState<boolean | null>(null);
  useEffect(() => {
    if (!open) return;
    invoke<boolean | { enabled: boolean }>("plugin:autostart|is_enabled")
      .then((r) => setAutoStart(typeof r === "boolean" ? r : !!r?.enabled))
      .catch(() => setAutoStart(null));
  }, [open]);
  const toggleAutoStart = async () => {
    const next = !autoStart;
    setAutoStart(next); // 乐观更新
    try {
      await invoke(next ? "plugin:autostart|enable" : "plugin:autostart|disable");
    } catch {
      setAutoStart(!next); // 失败回滚
    }
  };

  return (
    <Modal open={open} onClose={() => toggleOpen("settingsOpen")} title="设置" width={480}>
      <Section title="外观">
        <Row label="主题" hint="深浅色切换 150ms，跟随系统可选">
          <div style={{ display: "flex", gap: 6 }}>
            {(["light", "dark", "system"] as const).map((t) => (
              <button key={t} className="btn-ghost"
                style={app.theme === t ? { background: "var(--ff-bg-selected)", color: "var(--ff-primary)" } : undefined}
                onClick={() => app.setTheme(t)}>
                {t === "light" ? <Icons.Sun size={13} /> : t === "dark" ? <Icons.Moon size={13} /> : "系统"} {t === "light" ? "浅色" : t === "dark" ? "深色" : "跟随系统"}
              </button>
            ))}
          </div>
        </Row>
        <Row label="默认视图">
          <select value={app.viewMode} onChange={(e) => app.setViewMode(e.target.value as ViewMode)}
            style={selectStyle}>
            <option value="list">列表</option><option value="grid">宫格</option><option value="details">详情</option>
          </select>
        </Row>
        <Row label="显示隐藏文件" hint="Ctrl+H">
          <input type="checkbox" checked={app.showHidden} onChange={(e) => app.setShowHidden(e.target.checked)} />
        </Row>
      </Section>

      <Section title="启动">
        <Row label="开机自动启动" hint="写入当前用户注册表 Run 键，无需管理员权限；开启后 FileFly 启动即后台索引，主窗口可从托盘恢复">
          <input
            type="checkbox"
            checked={autoStart === true}
            disabled={autoStart === null}
            onChange={toggleAutoStart}
            title={autoStart === null ? "当前环境不可用" : undefined}
          />
        </Row>
        <Row label="关闭窗口" hint="点击 ✕ 隐藏到系统托盘，索引与预览保持运行；彻底退出请用托盘右键菜单 → 退出">
          <span style={{ color: "var(--ff-text-secondary)", fontSize: 13 }}>最小化到托盘</span>
        </Row>
      </Section>

      <Section title="性能">
        <Row label="缩略图池并发" hint={`当前 ${thumbConcurrency} 并发（技术文档 §3）`}>
          <span style={{ color: "var(--ff-text-secondary)", fontSize: 13 }}>{thumbConcurrency}</span>
        </Row>
        <Row label="枚举分批" hint="300 条/批 event 渐进渲染"><span style={{ color: "var(--ff-text-secondary)", fontSize: 13 }}>已启用</span></Row>
        <Row label="游标分页上限" hint="前端不持有 >2000 条完整记录"><span style={{ color: "var(--ff-text-secondary)", fontSize: 13 }}>2000</span></Row>
      </Section>

      <Section title="快捷键">
        {[
          ["Space", "空格预览 / Esc 关闭 / ←→ 切换"],
          ["Ctrl+P", "命令面板"],
          ["Ctrl+F", "聚焦搜索"],
          ["Ctrl+X / C / V", "剪切 / 复制 / 粘贴"],
          ["Ctrl+Shift+D", "双栏模式"],
          ["1~8", "快速打 8 色预设标签"],
        ].map(([k, v]) => (
          <Row key={k} label={<kbd style={{ background: "var(--ff-bg-app)", border: "1px solid var(--ff-border)", borderRadius: 4, padding: "2px 6px", fontSize: 11 }}>{k}</kbd>} hint={v}><span /></Row>
        ))}
      </Section>

      <Section title="关于">
        <Row label="FileFly" hint="Let your files fly · 让文件飞 · v0.1.0"><Icons.Logo size={22} /></Row>
      </Section>
    </Modal>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginBottom: 18 }}>
    <h4 style={{ margin: "0 0 8px", fontSize: 12, color: "var(--ff-text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</h4>
    {children}
  </div>
);
const Row: React.FC<{ label: React.ReactNode; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--ff-border)" }}>
    <div>
      <div style={{ fontSize: 13 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: "var(--ff-text-disabled)", marginTop: 2 }}>{hint}</div>}
    </div>
    {children}
  </div>
);
const selectStyle: React.CSSProperties = {
  background: "var(--ff-bg-card)", color: "var(--ff-text-primary)",
  border: "1px solid var(--ff-border)", borderRadius: 8, padding: "4px 8px", fontSize: 13,
};
