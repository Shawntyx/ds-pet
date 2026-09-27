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

// 数值来自 ASSETS.md §0（核对原项目 whale-moe-core.js 点击判定区得出）：
// 先匹配尾巴（贴底部满宽），再匹配肚子，都不命中算头。
export const DEFAULT_ZONES: InteractionZones = {
  tail: { x: 0.0, y: 0.78, w: 1.0, h: 0.22 },
  belly: { x: 0.18, y: 0.45, w: 0.64, h: 0.33 },
  head: { x: 0.2, y: 0.0, w: 0.6, h: 0.45 },
};

export const DEFAULT_SETTINGS: PetSettings = {
  spriteSize: 220,
  toggleShortcut: 'Ctrl+Alt+W',
  doNotDisturb: false,
  visible: true,
  zones: DEFAULT_ZONES,
};

/** 桌宠右键菜单可以触发的动作（对应桌宠状态机里的一次性反应）。 */
export type PetMenuAction = 'feed' | 'poke' | 'praise';

/** preload 暴露给渲染进程的 API 形状，主进程和渲染进程共用同一份类型定义。 */
export interface PetBridge {
  resolveAsset(filename: string): string;
  setIgnoreMouseEvents(ignore: boolean, forward?: boolean): void;
  setWindowPosition(x: number, y: number): void;
  getWindowPosition(): Promise<{ x: number; y: number }>;
  getWorkArea(): Promise<{ x: number; y: number; width: number; height: number }>;
  getSpriteSize(): Promise<number>;
  /** 在桌宠身上右键，请求主进程在旁边弹出自绘菜单。 */
  requestContextMenu(): void;
  /** 菜单里点了投喂/戳一下/夸夸，主进程转发过来让桌宠播对应反应。 */
  onTriggerAction(callback: (action: PetMenuAction) => void): void;
  /** 从隐藏状态被召唤出来时触发，用来播一下打招呼动作。 */
  onShown(callback: () => void): void;
}

/** menuPreload 暴露给菜单窗口渲染进程的 API 形状。 */
export interface MenuBridge {
  onInit(callback: (data: { doNotDisturb: boolean }) => void): void;
  selectAction(id: string): void;
  close(): void;
}
