import { contextBridge, ipcRenderer } from 'electron';
import type { ChatBridge, ChatMessageView } from '../shared/types';

const bridge: ChatBridge = {
  getHistory(): Promise<ChatMessageView[]> {
    return ipcRenderer.invoke('chat:get-history');
  },
  sendMessage(text: string): void {
    ipcRenderer.send('chat:send-message', text);
  },
  onDelta(callback: (delta: string) => void): void {
    ipcRenderer.on('chat:delta', (_event, delta: string) => callback(delta));
  },
  onDone(callback: () => void): void {
    ipcRenderer.on('chat:done', () => callback());
  },
  onError(callback: (message: string) => void): void {
    ipcRenderer.on('chat:error', (_event, message: string) => callback(message));
  },
};

contextBridge.exposeInMainWorld('chatAPI', bridge);
