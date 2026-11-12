/** @type {import('tailwindcss').Config} */
// FileFly 主题令牌全部来自 CSS Variables（packages/theme-tokens/tokens.json 生成），
// Tailwind 仅负责布局与间距，颜色一律引用 var(--ff-*)，保证深浅色零重建切换。
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", 'html[data-theme="dark"]'],
  theme: {
    borderRadius: {
      DEFAULT: "8px",
      lg: "12px",
      xl: "16px",
    },
    extend: {
      fontFamily: {
        ui: [
          "Segoe UI Variable",
          "Segoe UI",
          "SF Pro",
          "-apple-system",
          "Microsoft YaHei UI",
          "PingFang SC",
          "sans-serif",
        ],
        mono: ["Cascadia Code", "SF Mono", "Consolas", "monospace"],
      },
      colors: {
        primary: "var(--ff-primary)",
        "primary-hover": "var(--ff-primary-hover)",
        "primary-active": "var(--ff-primary-active)",
        accent: "var(--ff-accent)",
        success: "var(--ff-success)",
        warning: "var(--ff-warning)",
        danger: "var(--ff-danger)",
        app: "var(--ff-bg-app)",
        sidebar: "var(--ff-bg-sidebar)",
        content: "var(--ff-bg-content)",
        card: "var(--ff-bg-card)",
        hover: "var(--ff-bg-hover)",
        selected: "var(--ff-bg-selected)",
        border: "var(--ff-border)",
        "text-primary": "var(--ff-text-primary)",
        "text-secondary": "var(--ff-text-secondary)",
        "text-disabled": "var(--ff-text-disabled)",
      },
      transitionDuration: {
        theme: "150ms",
      },
    },
  },
  plugins: [],
};
