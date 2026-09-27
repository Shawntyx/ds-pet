import { contextBridge, ipcRenderer } from 'electron';
import type { MenuBridge } from '../shared/types';

const bridge: MenuBridge = {
  onInit(callback: (data: { doNotDisturb: boolean }) => void): void {
    ipcRenderer.on('menu:init', (_event, data) => callback(data));
  },
  selectAction(id: string): void {
    ipcRenderer.send('menu:action', id);
  },
  close(): void {
    ipcRenderer.send('menu:close');
  },
};

contextBridge.exposeInMainWorld('menuAPI', bridge);
