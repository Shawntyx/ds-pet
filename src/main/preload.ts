import { contextBridge, ipcRenderer } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { PetBridge } from '../shared/types';

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
};

contextBridge.exposeInMainWorld('petAPI', bridge);
