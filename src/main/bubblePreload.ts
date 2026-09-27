import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('bubbleAPI', {
  onSetText(callback: (text: string) => void): void {
    ipcRenderer.on('bubble:set-text', (_event, text: string) => callback(text));
  },
});
