import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/global.css";
import "./theme/tokens.css";

// 根级错误边界：任何未捕获的渲染崩溃都会显示可恢复的错误 UI，而非整窗白屏
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary label="应用根节点">
    <App />
  </ErrorBoundary>
);
