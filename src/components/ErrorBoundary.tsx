// 全局渲染错误边界：任何组件崩溃不再白屏死机，给出明确错误与恢复出口
// 背景：图片预览 EXIF null 崩溃曾导致整窗白屏且无法返回（React 卸载整棵树）
import React from "react";

interface EBProps {
  label?: string;
  /** 自定义降级 UI（如预览层：只关浮层不杀主界面） */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  children: React.ReactNode;
}
interface EBState { error: Error | null }

export class ErrorBoundary extends React.Component<EBProps, EBState> {
  state: EBState = { error: null };

  static getDerivedStateFromError(error: Error): EBState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 详细堆栈进控制台便于排查
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error && this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }
    if (error) {
      return (
        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--ff-bg-app)", padding: 40 }}>
          <div style={{ textAlign: "center", maxWidth: 620 }}>
            <div style={{ fontSize: 34, marginBottom: 12 }}>😵</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>界面组件出现错误{this.props.label ? `（${this.props.label}）` : ""}</h2>
            <p style={{ color: "var(--ff-text-secondary)", fontSize: 13, margin: "0 0 4px" }}>应用仍可安全使用，无需重启。</p>
            <p style={{ color: "var(--ff-text-disabled)", fontSize: 12, wordBreak: "break-all", margin: "8px 0 18px", fontFamily: "monospace" }}>
              {error.message}
            </p>
            <button className="btn-primary" style={{ marginRight: 10 }} onClick={this.reset}>重试</button>
            <button className="btn-ghost" onClick={() => location.reload()}>重载应用</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
