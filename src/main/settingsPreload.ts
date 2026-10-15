import { contextBridge, ipcRenderer } from 'electron';
import type { BalanceView, SettingsBridge, SettingsData } from '../shared/types';

const bridge: SettingsBridge = {
  load(): Promise<SettingsData> {
    return ipcRenderer.invoke('settings:load');
  },
  save(data: Partial<SettingsData> & { apiKey?: string }): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke('settings:save', data);
  },
  openPersonaFile(): void {
    ipcRenderer.send('settings:open-persona-file');
  },
  refreshBalance(): Promise<BalanceView> {
    return ipcRenderer.invoke('settings:refresh-balance');
  },
  onBalanceChanged(callback: (data: SettingsData) => void): void {
    ipcRenderer.on('settings:balance-changed', (_event, data: SettingsData) => callback(data));
  },
  clearChatHistory(): Promise<{ ok: boolean; cleared: number }> {
    return ipcRenderer.invoke('settings:clear-chat-history');
  },
  openMemoryFile(): void {
    ipcRenderer.send('settings:open-memory-file');
  },
  deleteMemoryFact(id: string): Promise<{ ok: boolean; remaining: number }> {
    return ipcRenderer.invoke('settings:delete-memory-fact', id);
  },
  clearMemory(): Promise<{ ok: boolean; cleared: number }> {
    return ipcRenderer.invoke('settings:clear-memory');
  },
};

contextBridge.exposeInMainWorld('settingsAPI', bridge);
