import { BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
import { createTagStrippingRelay, getHistory, sendUserMessage } from './chatSession';
import type { ChatMessageView } from '../shared/types';

let chatWindow: BrowserWindow | null = null;
let petWindowRef: BrowserWindow | null = null;
/** 聊天面板关闭时，把这句话用气泡显示在桌宠头上（SPEC 5.2："关闭后桌宠头上用气泡显示最新一句"）。 */
let lastReply: { text: string; emotion: string | null } | null = null;

function historyView(): ChatMessageView[] {
  return getHistory().map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

function createChatWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 360,
    height: 480,
    minWidth: 280,
    minHeight: 320,
    title: '和鲸鱼娘聊天',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'chatPreload.js'),
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/chat.html'));
  win.on('closed', () => {
    chatWindow = null;
    if (lastReply && petWindowRef && !petWindowRef.isDestroyed()) {
      petWindowRef.webContents.send('pet:reply', lastReply);
    }
  });
  return win;
}

function positionNearPet(win: BrowserWindow): void {
  if (!petWindowRef) return;
  const petBounds = petWindowRef.getBounds();
  const { workArea } = screen.getDisplayMatching(petBounds);
  const [w, h] = win.getSize();

  let x = petBounds.x - w - 12;
  if (x < workArea.x) x = petBounds.x + petBounds.width + 12;
  if (x + w > workArea.x + workArea.width) x = workArea.x + workArea.width - w;

  let y = petBounds.y + petBounds.height - h;
  if (y < workArea.y) y = workArea.y;
  if (y + h > workArea.y + workArea.height) y = workArea.y + workArea.height - h;

  win.setPosition(Math.round(x), Math.round(y));
}

export function showChatWindow(): void {
  if (!chatWindow || chatWindow.isDestroyed()) {
    chatWindow = createChatWindow();
  }
  positionNearPet(chatWindow);
  chatWindow.show();
  chatWindow.focus();
}

export function initChat(petWindow: BrowserWindow): void {
  petWindowRef = petWindow;

  ipcMain.removeHandler('chat:get-history');
  ipcMain.removeAllListeners('chat:send-message');

  ipcMain.handle('chat:get-history', () => historyView());

  ipcMain.on('chat:send-message', (_event, text: string) => {
    if (typeof text !== 'string' || !text.trim()) return;
    const win = chatWindow;
    const relayDelta = createTagStrippingRelay((clean) => win?.webContents.send('chat:delta', clean));
    sendUserMessage(text.trim(), {
      onThinkingStart: () => {
        petWindowRef?.webContents.send('pet:thinking-start');
      },
      onDelta: (delta) => {
        relayDelta(delta);
      },
      onDone: (payload) => {
        lastReply = payload;
        win?.webContents.send('chat:done');
        // 聊天面板开着的时候也让桌宠同步换表情，不用等关闭面板才有反应。
        petWindowRef?.webContents.send('pet:reply', payload);
      },
      onError: (message) => {
        win?.webContents.send('chat:error', message);
      },
    });
  });
}
