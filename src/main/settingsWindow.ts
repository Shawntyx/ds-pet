import { BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { loadSettings, updateSettings } from './config';
import { listPersonas, personaFilePath } from './persona';
import { hasApiKey, saveApiKey } from './secrets';
import { refreshTrayMenu } from './tray';
import { registerGlobalShortcuts } from './shortcuts';
import type { SettingsData } from '../shared/types';

let settingsWindow: BrowserWindow | null = null;
let petWindowRef: BrowserWindow | null = null;
let setVisibleRef: ((visible: boolean) => void) | null = null;

function createSettingsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 560,
    minWidth: 360,
    minHeight: 420,
    title: '设置',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'settingsPreload.js'),
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/settings.html'));
  win.on('closed', () => {
    settingsWindow = null;
  });
  return win;
}

export function showSettingsWindow(): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    settingsWindow = createSettingsWindow();
  }
  settingsWindow.show();
  settingsWindow.focus();
}

function toSettingsData(): SettingsData {
  const s = loadSettings();
  return {
    baseURL: s.baseURL,
    model: s.model,
    toggleShortcut: s.toggleShortcut,
    hasApiKey: hasApiKey(),
    activePersona: s.activePersona,
    personas: listPersonas(),
    proactive: s.proactive,
  };
}

export function initSettings(petWindow: BrowserWindow, setVisible: (visible: boolean) => void): void {
  petWindowRef = petWindow;
  setVisibleRef = setVisible;

  ipcMain.removeHandler('settings:load');
  ipcMain.removeHandler('settings:save');
  ipcMain.removeAllListeners('settings:open-persona-file');

  ipcMain.handle('settings:load', () => toSettingsData());

  ipcMain.handle('settings:save', (_event, data: Partial<SettingsData> & { apiKey?: string }) => {
    try {
      const { apiKey, hasApiKey: _ignored, personas: _ignored2, ...patch } = data;
      if (typeof apiKey === 'string' && apiKey.trim()) {
        saveApiKey(apiKey.trim());
      }
      updateSettings(patch);

      if (patch.toggleShortcut && petWindowRef && setVisibleRef) {
        registerGlobalShortcuts(petWindowRef, setVisibleRef);
      }
      refreshTrayMenu();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.on('settings:open-persona-file', () => {
    const settings = loadSettings();
    shell.openPath(personaFilePath(settings.activePersona));
  });
}
