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
};

contextBridge.exposeInMainWorld('settingsAPI', bridge);
