import { BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { loadSettings, updateSettings } from './config';
import { listPersonas, personaFilePath } from './persona';
import { hasApiKey, saveApiKey } from './secrets';
import { refreshTrayMenu } from './tray';
import { getBalanceView, refreshBalance } from './balance';
import { registerGlobalShortcuts } from './shortcuts';
import type { SettingsData } from '../shared/types';

let settingsWindow: BrowserWindow | null = null;
let petWindowRef: BrowserWindow | null = null;
let setVisibleRef: ((visible: boolean) => void) | null = null;

function createSettingsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 640,
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
    afkAfterMinutes: s.afkAfterMinutes,
    balanceWarnThreshold: s.balanceWarnThreshold,
    balance: getBalanceView(),
    proactive: s.proactive,
  };
}

export function initSettings(petWindow: BrowserWindow, setVisible: (visible: boolean) => void): void {
  petWindowRef = petWindow;
  setVisibleRef = setVisible;

  ipcMain.removeHandler('settings:load');
  ipcMain.removeHandler('settings:save');
  ipcMain.removeHandler('settings:refresh-balance');
  ipcMain.removeAllListeners('settings:open-persona-file');

  ipcMain.handle('settings:load', () => toSettingsData());

  ipcMain.handle('settings:save', async (_event, data: Partial<SettingsData> & { apiKey?: string }) => {
    try {
      // balance 是只读快照不是设置项，必须剔掉，否则会被写进 settings.json。
      const { apiKey, hasApiKey: _ignored, personas: _ignored2, balance: _ignored3, ...patch } = data;
      const keyChanged = typeof apiKey === 'string' && apiKey.trim().length > 0;
      const baseURLChanged = typeof patch.baseURL === 'string' && patch.baseURL !== loadSettings().baseURL;
      if (keyChanged) {
        saveApiKey((apiKey as string).trim());
      }
      updateSettings(patch);

      if (patch.toggleShortcut && petWindowRef && setVisibleRef) {
        registerGlobalShortcuts(petWindowRef, setVisibleRef);
      }
      refreshTrayMenu();

      // 换了 Key 或 Base URL，余额数字就是上一个账号的了，顺手重查一次再返回，
      // 这样界面保存后 load() 拿到的就是新账号的余额。
      if (keyChanged || baseURLChanged) {
        await refreshBalance();
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 设置页的"立即查询"按钮走这里：不等 6 小时的定时，也不写任何设置。
  ipcMain.handle('settings:refresh-balance', () => refreshBalance());

  ipcMain.on('settings:open-persona-file', () => {
    const settings = loadSettings();
    shell.openPath(personaFilePath(settings.activePersona));
  });
}
