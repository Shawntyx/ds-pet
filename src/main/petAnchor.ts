import { BrowserWindow } from 'electron';
import type { PlacementRect } from './popupPlacement';

// "角色实际画面"在屏幕上的矩形。
//
// 桌宠窗口是个 220×220 的方块，角色周围一圈全是透明的；探头姿势还会整体缩到 0.75 倍。
// 气泡/右键菜单/聊天面板如果按窗口矩形来摆，看起来就会离人物很远，或者明明离屏幕边缘还很远
// 却被判成"放不下"。所以渲染进程在换姿势时会把画面相对窗口的偏移报上来（dx/dy/width/height），
// 主进程用它 + 窗口当前位置算出真正的画面矩形。

let petWindowRef: BrowserWindow | null = null;
let offset = { dx: 0, dy: 0, width: 0, height: 0 };

export function initPetAnchor(petWindow: BrowserWindow): void {
  petWindowRef = petWindow;
  offset = { dx: 0, dy: 0, width: 0, height: 0 };
}

export function setPetAnchor(rect: { dx: number; dy: number; width: number; height: number }): void {
  if (
    !rect ||
    ![rect.dx, rect.dy, rect.width, rect.height].every((value) => Number.isFinite(value)) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return; // 渲染进程还没报过（或报了脏数据）：继续用窗口矩形兜底
  }
  offset = { dx: rect.dx, dy: rect.dy, width: rect.width, height: rect.height };
}

/** 没收到过 anchor 时退化成整个窗口矩形，保证一定有个可用的值。 */
export function petAnchorRect(): PlacementRect {
  if (!petWindowRef || petWindowRef.isDestroyed()) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const bounds = petWindowRef.getBounds();
  return {
    x: bounds.x + offset.dx,
    y: bounds.y + offset.dy,
    width: offset.width > 0 ? offset.width : bounds.width,
    height: offset.height > 0 ? offset.height : bounds.height,
  };
}
