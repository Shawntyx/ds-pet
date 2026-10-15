import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as path from 'path';
import { loadSettings, updateSettings } from './config';
import { listPersonas, personaFilePath } from './persona';
import { apiKeyStatus, describeApiKeyStatus, hasApiKey, saveApiKey } from './secrets';
import { refreshTrayMenu } from './tray';
import { formatBalanceForSettings, getBalanceView, onBalanceChange, refreshBalance } from './balance';
import { sendToWindow, isWindowVisible } from './safeSend';
import { clearMessages, flushChatStore, messageCount } from './chatStore';
import {
  clearFacts,
  deleteFact,
  ensureMemoryFile,
  factCount,
  flushMemoryStore,
  getFacts,
  memoryFilePath,
} from './memory';
import { registerGlobalShortcuts } from './shortcuts';
import type { SettingsData } from '../shared/types';

let settingsWindow: BrowserWindow | null = null;
let petWindowRef: BrowserWindow | null = null;
let setVisibleRef: ((visible: boolean) => void) | null = null;
/** onBalanceChange 没有反注册，这个模块又在窗口重建时会被重复调用，所以只挂一次。 */
let balanceListenerBound = false;

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
  const keyStatus = apiKeyStatus();
  return {
    baseURL: s.baseURL,
    model: s.model,
    toggleShortcut: s.toggleShortcut,
    hasApiKey: hasApiKey(),
    apiKeyState: keyStatus.state,
    apiKeyHint: describeApiKeyStatus(keyStatus),
    userDataPath: app.getPath('userData'),
    version: app.getVersion(),
    activePersona: s.activePersona,
    personas: listPersonas(),
    afkAfterMinutes: s.afkAfterMinutes,
    balanceWarnThreshold: s.balanceWarnThreshold,
    balance: getBalanceView(),
    balanceText: formatBalanceForSettings(getBalanceView()),
    chatHistoryRounds: s.chatHistoryRounds,
    chatMessageCount: messageCount(),
    memoryEnabled: s.memoryEnabled,
    memoryExtractEveryRounds: s.memoryExtractEveryRounds,
    memoryInjectCount: s.memoryInjectCount,
    memoryFactCount: factCount(),
    // 设置页只展示最近 50 条（最新的在前）：够用来逐条删了，也不用把几百条全塞进界面。
    memoryFacts: [...getFacts()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map((fact) => ({ id: fact.id, text: fact.text, createdAt: fact.createdAt })),
    memoryFilePath: memoryFilePath(),
    proactive: s.proactive,
  };
}

export function initSettings(petWindow: BrowserWindow, setVisible: (visible: boolean) => void): void {
  petWindowRef = petWindow;
  setVisibleRef = setVisible;

  // 余额一变就把最新数据推给打开着的设置页——不然它会一直显示打开那一刻的旧数字
  // （用户就踩到过：设置页显示 0，其实那时已经查到真余额了）。
  if (!balanceListenerBound) {
    balanceListenerBound = true;
    onBalanceChange(() => {
      if (isWindowVisible(settingsWindow)) {
        sendToWindow(settingsWindow, 'settings:balance-changed', toSettingsData());
      }
    });
  }

  ipcMain.removeHandler('settings:load');
  ipcMain.removeHandler('settings:save');
  ipcMain.removeHandler('settings:refresh-balance');
  ipcMain.removeHandler('settings:clear-chat-history');
  ipcMain.removeHandler('settings:delete-memory-fact');
  ipcMain.removeHandler('settings:clear-memory');
  ipcMain.removeAllListeners('settings:open-persona-file');
  ipcMain.removeAllListeners('settings:open-memory-file');

  ipcMain.handle('settings:load', () => toSettingsData());

  ipcMain.handle('settings:save', async (_event, data: Partial<SettingsData> & { apiKey?: string }) => {
    try {
      // balance / chatMessageCount / memory* 都是只读快照不是设置项，必须剔掉，否则会被写进 settings.json。
      const {
        apiKey,
        hasApiKey: _ignored,
        apiKeyState: _ignoredA,
        apiKeyHint: _ignoredB,
        userDataPath: _ignoredC,
        personas: _ignored2,
        balance: _ignored3,
        chatMessageCount: _ignored4,
        memoryFactCount: _ignored5,
        memoryFacts: _ignored6,
        memoryFilePath: _ignored7,
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
    sendToWindow(petWindowRef, 'pet:reply', {
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

  // 打开数据目录：里面有日志（logs/app.log）、设置、聊天记录、记忆，
  // 反馈问题时让用户一键打开，比让他照着手打 %APPDATA% 路径强得多。
  ipcMain.on('settings:open-data-dir', () => {
    shell.openPath(app.getPath('userData'));
  });

  // 打开记忆文件：用户可以直接在编辑器里改文字或删掉某几行（和"打开人设文件"一个路子）。
  ipcMain.on('settings:open-memory-file', () => {
    shell.openPath(ensureMemoryFile());
  });

  ipcMain.handle('settings:delete-memory-fact', (_event, id: string) => {
    if (typeof id !== 'string') return { ok: false, remaining: factCount() };
    const ok = deleteFact(id);
    if (ok) flushMemoryStore();
    return { ok, remaining: factCount() };
  });

  // 清空全部记忆：不可恢复，先弹原生确认框。
  ipcMain.handle('settings:clear-memory', async () => {
    const count = factCount();
    if (count === 0) return { ok: false, cleared: 0 };

    const options = {
      type: 'question' as const,
      buttons: ['取消', '清空'],
      defaultId: 0,
      cancelId: 0,
      message: '要清空她记住的所有事吗？',
      detail: `会删掉 ${count} 条长期记忆，清空后不可恢复（聊天记录和人设不受影响）。`,
    };
    const parent = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : petWindowRef;
    const choice = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    if (choice.response !== 1) return { ok: false, cleared: 0 };

    const cleared = clearFacts();
    flushMemoryStore();
    sendToWindow(petWindowRef, 'pet:reply', {
      text: '唔…我把记的事都忘掉了，我们重新认识一下吧？',
      emotion: null,
      pose: 'sweep',
    });
    return { ok: true, cleared };
  });
}
