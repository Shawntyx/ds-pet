import type { BrowserWindow } from 'electron';

/**
 * 往窗口发消息，但窗口可能已经关了。
 *
 * 为什么必须有这个：面板/气泡关掉之后，`BrowserWindow` 对象还在（我们的局部变量还指着它），
 * 但 `webContents` 已经变成 null。这时候 `win.webContents.send(...)` 会抛 TypeError；
 * 而这个调用往往发生在**模型流式回调**里——异常被 provider 的读流 catch 吞掉，最后被当成
 * "请求失败"，于是把用户刚发的那句话也从历史里撤回了。表现就是：回复打到一半关掉面板，
 * 这句话连同提问一起凭空消失。
 *
 * 所以凡是"往可能已经关掉的窗口发消息"的地方都走这里：关了就安静地丢掉（真正的收尾逻辑
 * 由调用方按 isDestroyed 判断该不该改走气泡），绝不往外抛。
 */
export function sendToWindow(
  window: BrowserWindow | null | undefined,
  channel: string,
  ...args: unknown[]
): boolean {
  if (!window || window.isDestroyed()) return false;
  const contents = window.webContents;
  if (!contents || contents.isDestroyed()) return false;
  try {
    contents.send(channel, ...args);
    return true;
  } catch (err) {
    console.error(`[whale-pet] 向窗口发送 ${channel} 失败:`, err);
    return false;
  }
}

/** 窗口是否还活着并且可见（用来判断"面板是不是还开着"）。 */
export function isWindowVisible(window: BrowserWindow | null | undefined): boolean {
  return !!window && !window.isDestroyed() && window.isVisible();
}
