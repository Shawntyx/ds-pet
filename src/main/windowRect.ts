import type { BrowserWindow } from 'electron';

// 这个文件是给"移动窗口"兜底的，因为这台机器上实测到两个坑（隔离实验的结论，别再踩）：
//
// 1) 对透明无边框窗口调用 `setPosition(x, y)`，会把窗口尺寸也改掉——被移动的那个轴跟着变长：
//      x 减 5 → 宽度 +5；y 减 5 → 高度 +5（底层把"移动"当成了"拖右下角"）。
//    桌宠走动时每秒会调几十次，于是她的窗口越走越大；气泡更明显——输入框是 width:100%，
//    表现出来就是"气泡下面的回复框不断拉长"。
// 2) `setPosition` 传小数坐标会直接抛 `TypeError: Error processing argument at index 1,
//    conversion failure`。主进程里没人接这个异常 → Electron 弹"JavaScript error"对话框
//    （气泡只在主动说话/互动时可见，所以看起来就是"她一主动说话就弹错"）。
//
// 而每次都调 `setBounds` 并把尺寸一起写死，尺寸就稳定（±1px 的边界误差，不会累积）。
// 所以所有窗口移动统一走这里。

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 取整 + 有限性校验；任何一项不合法就返回 null（宁可这次不摆位，也绝不把 NaN 传给 Electron）。 */
export function normalizeWindowRect(rect: WindowRect): WindowRect | null {
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/** 设置窗口的完整矩形（位置 + 尺寸）。窗口已关闭或参数非法就安静跳过。 */
export function setWindowRect(win: BrowserWindow | null | undefined, rect: WindowRect): boolean {
  if (!win || win.isDestroyed()) return false;
  const normalized = normalizeWindowRect(rect);
  if (!normalized) {
    console.error('[whale-pet] 窗口摆位参数不合法，已跳过:', rect);
    return false;
  }
  try {
    win.setBounds(normalized);
    return true;
  } catch (err) {
    console.error('[whale-pet] setBounds 失败:', err);
    return false;
  }
}

/**
 * 只移动、保持当前尺寸。聊天面板这种用户可能自己拖过大小的窗口用这个
 * （它的尺寸是我们不掌握的，所以要读当前 bounds 再一起设回去）。
 */
export function moveWindowTo(win: BrowserWindow | null | undefined, x: number, y: number): boolean {
  if (!win || win.isDestroyed()) return false;
  const { width, height } = win.getBounds();
  return setWindowRect(win, { x, y, width, height });
}
