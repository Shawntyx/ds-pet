import { contextBridge, ipcRenderer } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { whaleAssetsDir } from './paths';
import type { PetBridge, PetMenuAction, PresenceState } from '../shared/types';

// 素材仓库以 git submodule 形式放在 assets/whale/assets/generated 下；
// 打包后素材在 resources/whale-assets 里（见 paths.ts）。
const ASSETS_ROOT = path.join(whaleAssetsDir(), 'assets', 'generated');

// 渲染进程的报错在打包版里是"看不见"的（GUI 进程没有终端，用户也不会开 DevTools），
// 出问题时只能靠猜。这里挂钩子，把报错和一条启动诊断报给主进程写进日志文件。
function reportToMain(channel: string, payload: Record<string, unknown>): void {
  try {
    ipcRenderer.send(channel, payload);
  } catch {
    /* 忽略 */
  }
}

window.addEventListener('error', (event) => {
  reportToMain('app:renderer-error', {
    source: 'window.error',
    message: event.message,
    stack: event.error && event.error.stack ? String(event.error.stack) : `${event.filename}:${event.lineno}`,
  });
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  reportToMain('app:renderer-error', {
    source: 'unhandledrejection',
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

// 素材路径是打包后最容易出错的地方（asar 里 vs asar 外），启动时报一行，排查时一眼能看到。
reportToMain('app:renderer-log', {
  source: 'preload',
  message: `素材目录=${ASSETS_ROOT} | resourcesPath=${process.resourcesPath}`,
});

const bridge: PetBridge = {
  resolveAsset(filename: string): string {
    return pathToFileURL(path.join(ASSETS_ROOT, filename)).toString();
  },
  setIgnoreMouseEvents(ignore: boolean, forward = true): void {
    ipcRenderer.send('pet:set-ignore-mouse-events', ignore, forward);
  },
  setWindowPosition(x: number, y: number): void {
    ipcRenderer.send('pet:set-window-position', Math.round(x), Math.round(y));
  },
  getWindowPosition(): Promise<{ x: number; y: number }> {
    return ipcRenderer.invoke('pet:get-window-position');
  },
  getWorkArea(): Promise<{ x: number; y: number; width: number; height: number }> {
    return ipcRenderer.invoke('pet:get-work-area');
  },
  getSpriteSize(): Promise<number> {
    return ipcRenderer.invoke('pet:get-sprite-size');
  },
  requestContextMenu(): void {
    ipcRenderer.send('pet:request-context-menu');
  },
  onTriggerAction(callback: (action: PetMenuAction) => void): void {
    ipcRenderer.on('pet:trigger-action', (_event, action: PetMenuAction) => callback(action));
  },
  onShown(callback: () => void): void {
    ipcRenderer.on('pet:shown', () => callback());
  },
  onThinkingStart(callback: () => void): void {
    ipcRenderer.on('pet:thinking-start', () => callback());
  },
  onReply(
    callback: (payload: {
      text: string;
      emotion: string | null;
      pose?: string | null;
      bubble?: boolean;
    }) => void
  ): void {
    ipcRenderer.on(
      'pet:reply',
      (
        _event,
        payload: { text: string; emotion: string | null; pose?: string | null; bubble?: boolean }
      ) => callback(payload)
    );
  },
  setAnchor(rect: { dx: number; dy: number; width: number; height: number }): void {
    ipcRenderer.send('pet:set-anchor', rect);
  },
  onPresence(callback: (presence: PresenceState) => void): void {
    ipcRenderer.on('pet:presence', (_event, presence: PresenceState) => callback(presence));
  },
  onBalanceLow(callback: (payload: { text: string }) => void): void {
    ipcRenderer.on('pet:balance-low', (_event, payload: { text: string }) => callback(payload));
  },
  showBubble(text: string): void {
    ipcRenderer.send('pet:show-bubble', text);
  },
};

contextBridge.exposeInMainWorld('petAPI', bridge);
