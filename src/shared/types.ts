// 主进程和渲染进程都会用到的类型定义。

export type PetState =
  | 'idle'
  | 'blink'
  | 'tailSwing'
  | 'walking'
  | 'dragging'
  | 'falling'
  | 'petHead'
  | 'petTail'
  | 'pokeBelly'
  | 'afk';

/** 互动区域：相对窗口宽高的比例矩形（0~1），方便窗口尺寸变化时跟着缩放。 */
export interface ZoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InteractionZones {
  head: ZoneRect;
  tail: ZoneRect;
  belly: ZoneRect;
}

export interface PetSettings {
  /** 显示尺寸（正方形窗口边长，像素） */
  spriteSize: number;
  /** 隐藏/召唤桌宠的全局快捷键 */
  toggleShortcut: string;
  /** 勿扰模式：暂停主动说话（阶段 3 用，这里先存开关） */
  doNotDisturb: boolean;
  /** 桌宠是否可见 */
  visible: boolean;
  /** 互动区域配置，方便以后调整 */
  zones: InteractionZones;
}

export const DEFAULT_ZONES: InteractionZones = {
  head: { x: 0.28, y: 0.0, w: 0.44, h: 0.28 },
  tail: { x: 0.62, y: 0.35, w: 0.36, h: 0.35 },
  belly: { x: 0.3, y: 0.42, w: 0.4, h: 0.3 },
};

export const DEFAULT_SETTINGS: PetSettings = {
  spriteSize: 220,
  toggleShortcut: 'Ctrl+Alt+W',
  doNotDisturb: false,
  visible: true,
  zones: DEFAULT_ZONES,
};

/** preload 暴露给渲染进程的 API 形状，主进程和渲染进程共用同一份类型定义。 */
export interface PetBridge {
  resolveAsset(filename: string): string;
  setIgnoreMouseEvents(ignore: boolean, forward?: boolean): void;
  setWindowPosition(x: number, y: number): void;
  getWindowPosition(): Promise<{ x: number; y: number }>;
  getWorkArea(): Promise<{ x: number; y: number; width: number; height: number }>;
  getSpriteSize(): Promise<number>;
}
