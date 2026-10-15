import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as path from 'path';
import { loadSettings, updateSettings } from './config';
import { listPersonas, personaFilePath } from './persona';
import { hasApiKey, saveApiKey } from './secrets';
import { refreshTrayMenu } from './tray';
import { getBalanceView, refreshBalance } from './balance';
import { clearMessages, flushChatStore, messageCount } from './chatStore';
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
    chatHistoryRounds: s.chatHistoryRounds,
    chatMessageCount: messageCount(),
    proactive: s.proactive,
  };
}

export function initSettings(petWindow: BrowserWindow, setVisible: (visible: boolean) => void): void {
  petWindowRef = petWindow;
  setVisibleRef = setVisible;

  ipcMain.removeHandler('settings:load');
  ipcMain.removeHandler('settings:save');
  ipcMain.removeHandler('settings:refresh-balance');
  ipcMain.removeHandler('settings:clear-chat-history');
  ipcMain.removeAllListeners('settings:open-persona-file');

  ipcMain.handle('settings:load', () => toSettingsData());

  ipcMain.handle('settings:save', async (_event, data: Partial<SettingsData> & { apiKey?: string }) => {
    try {
      // balance / chatMessageCount 是只读快照不是设置项，必须剔掉，否则会被写进 settings.json。
      const {
        apiKey,
        hasApiKey: _ignored,
        personas: _ignored2,
        balance: _ignored3,
        chatMessageCount: _ignored4,
        ...patch
      } = data;
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

  // 清空聊天记录：删本地文件，不可恢复，所以先弹一个原生确认框。
  ipcMain.handle('settings:clear-chat-history', async () => {
    const count = messageCount();
    if (count === 0) return { ok: false, cleared: 0 };

    const options = {
      type: 'question' as const,
      buttons: ['取消', '清空'],
      defaultId: 0,
      cancelId: 0,
      message: '要清空本机的聊天记录吗？',
      detail: `会删掉已经保存的 ${count} 条消息，清空后不可恢复（人设文件和记忆不受影响）。`,
    };
    const parent = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : petWindowRef;
    const choice = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    if (choice.response !== 1) return { ok: false, cleared: 0 };

    const cleared = clearMessages();
    flushChatStore();
    // 用扫帚姿势收个尾（ASSETS.md §6 建议的用法）。
    petWindowRef?.webContents.send('pet:reply', {
      text: '聊天记录都擦干净啦～',
      emotion: null,
      pose: 'sweep',
    });
    return { ok: true, cleared };
  });

  ipcMain.on('settings:open-persona-file', () => {
    const settings = loadSettings();
    shell.openPath(personaFilePath(settings.activePersona));
  });
}
