import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('bubbleAPI', {
  onSetText(callback: (text: string) => void): void {
    ipcRenderer.on('bubble:set-text', (_event, text: string) => callback(text));
  },
  sendMessage(text: string): void {
    ipcRenderer.send('bubble:send-message', text);
  },
  onDelta(callback: (delta: string) => void): void {
    ipcRenderer.on('bubble:delta', (_event, delta: string) => callback(delta));
  },
  onDone(callback: () => void): void {
    ipcRenderer.on('bubble:done', () => callback());
  },
  onStopped(callback: (payload: { text: string } | null) => void): void {
    ipcRenderer.on('bubble:stopped', (_event, payload: { text: string } | null) => callback(payload));
  },
  onError(callback: (message: string) => void): void {
    ipcRenderer.on('bubble:error', (_event, message: string) => callback(message));
  },
  openChat(): void {
    ipcRenderer.send('bubble:open-chat');
  },
  close(): void {
    ipcRenderer.send('bubble:close');
  },
});
