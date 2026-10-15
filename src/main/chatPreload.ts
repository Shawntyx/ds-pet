import { contextBridge, ipcRenderer } from 'electron';
import type { ChatBridge, ChatMessageView } from '../shared/types';

const bridge: ChatBridge = {
  getHistory(): Promise<ChatMessageView[]> {
    return ipcRenderer.invoke('chat:get-history');
  },
  sendMessage(text: string): void {
    ipcRenderer.send('chat:send-message', text);
  },
  cancel(): void {
    ipcRenderer.send('chat:cancel');
  },
  newConversation(): void {
    ipcRenderer.send('chat:new-conversation');
  },
  onDelta(callback: (delta: string) => void): void {
    ipcRenderer.on('chat:delta', (_event, delta: string) => callback(delta));
  },
  onDone(callback: () => void): void {
    ipcRenderer.on('chat:done', () => callback());
  },
  onStopped(callback: (payload: { text: string } | null) => void): void {
    ipcRenderer.on('chat:stopped', (_event, payload: { text: string } | null) => callback(payload));
  },
  onError(callback: (message: string) => void): void {
    ipcRenderer.on('chat:error', (_event, message: string) => callback(message));
  },
};

contextBridge.exposeInMainWorld('chatAPI', bridge);
