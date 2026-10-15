import { contextBridge, ipcRenderer } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { PetBridge, PetMenuAction, PresenceState } from '../shared/types';

// 素材仓库以 git submodule 形式放在 assets/whale/assets/generated 下。
const ASSETS_ROOT = path.join(__dirname, '../../assets/whale/assets/generated');

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
