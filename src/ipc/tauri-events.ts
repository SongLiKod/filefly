// Tauri 原生事件桥（打包进 Tauri 时使用；浏览器模式不会被调用）
export async function bindTauriEvent(name: string, fn: (p: unknown) => void) {
  try {
    const mod = await import("@tauri-apps/api/event");
    await mod.listen(name, (e) => fn(e.payload));
  } catch {
    // @tauri-apps/api 未安装时静默（浏览器模式）
  }
}
