import { BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
import { createTagStrippingRelay, getHistory, sendUserMessage } from './chatSession';
import { petAnchorRect } from './petAnchor';
import { placeSidePanel } from './popupPlacement';
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
  const anchor = petAnchorRect();
  const { workArea } = screen.getDisplayMatching(anchor);
  const [w, h] = win.getSize();
  // 和右键菜单同一套摆位规则：人物贴右边缘时面板自动翻到左边。
  const { x, y } = placeSidePanel(anchor, workArea, { width: w, height: h }, 12);
  win.setPosition(x, y);
}

/** 聊天面板现在是不是开着——开着的时候不再弹气泡（文本就在面板里，弹了是重复的）。 */
export function isChatWindowOpen(): boolean {
  return !!chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible();
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
        // 聊天面板开着的时候只让桌宠换表情，不再弹气泡（文本已经在面板里了）；
        // 面板关掉时下面的 'closed' 回调会把最后一句用气泡补上。
        petWindowRef?.webContents.send('pet:reply', { ...payload, bubble: false });
      },
      onError: (message) => {
        win?.webContents.send('chat:error', message);
      },
    });
  });
}
