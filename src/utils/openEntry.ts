// 统一的"打开文件"路由：可执行文件直接运行（真实 Windows 安装/启动行为），其余进 QuickLook 预览
import { api } from "@/ipc/client";
import { usePreview } from "@/features/preview/previewStore";

/** Windows 可执行/安装/脚本扩展名：双击 = 直接运行 */
const EXECUTABLE_EXTS = new Set(["exe", "msi", "msp", "msix", "bat", "cmd", "com", "scr", "ps1", "vbs", "jar", "apk"]);

export const extOf = (path: string): string => {
  const name = path.split(/[\\/]/).pop() ?? "";
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
};

export const isExecutable = (path: string): boolean => EXECUTABLE_EXTS.has(extOf(path));

/**
 * 智能打开入口（双击 / Enter / 搜索结果）：
 * - 目录 → navigate 回调
 * - 可执行（exe/msi/…）→ ShellExecuteW 运行（安装器会正常弹 UAC/安装向导）
 * - 其他文件 → 内置 QuickLook 预览
 */
export async function openEntrySmart(
  path: string,
  isDir: boolean,
  navigate?: () => void
): Promise<void> {
  // 记录"最近使用"（F-22）：fire-and-forget，失败不影响打开动作（此前命令未注册时此处静默失败导致记录表恒空）
  api.fsRecordRecent(path, isDir ? "location" : "file").catch(() => {});
  if (isDir) {
    navigate?.();
    return;
  }
  if (isExecutable(path)) {
    try {
      await api.fsOpen(path);
    } catch (err) {
      const { alertDialog } = await import("@/components/dialog");
      alertDialog("运行失败", String(err), "error");
    }
    return;
  }
  usePreview.getState().show([path], 0);
}
