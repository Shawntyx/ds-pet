import { contextBridge, ipcRenderer } from 'electron';
import type { SettingsBridge, SettingsData } from '../shared/types';

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
};

contextBridge.exposeInMainWorld('settingsAPI', bridge);
