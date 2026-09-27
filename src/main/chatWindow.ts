import { BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
import { EMOTION_TAGS, getHistory, sendUserMessage } from './chatSession';
import type { ChatMessageView } from '../shared/types';

const TAG_PATTERN = new RegExp(`^\\s*\\[(${EMOTION_TAGS.join('|')})\\]\\s*`, 'i');
/** 攒够这么多字符还没能判断出是不是标签，就放弃等待、原样吐出去（防止异常输出卡住不出字）。 */
const TAG_SNIFF_LIMIT = 20;

/**
 * persona.md 要求模型把情绪标签放在回复最开头、且不能让用户看到。标签是一路流式吐出来的，
 * 不能只在最后（onDone）才去掉——所以这里在真正转发给聊天窗口之前，先攒住开头这一小段，
 * 判断出"确实是/确定不是"标签之后再决定要不要把标签部分吃掉。
 */
function createTagStrippingRelay(onClean: (text: string) => void): (raw: string) => void {
  let buffer = '';
  let resolved = false;
  return (raw: string) => {
    if (resolved) {
      onClean(raw);
      return;
    }
    buffer += raw;
    const stillMaybeOpeningTag = /^\s*\[[a-zA-Z]*$/.test(buffer) && !buffer.includes(']');
    if (stillMaybeOpeningTag && buffer.length < TAG_SNIFF_LIMIT) {
      return; // 还判断不出来，继续攒
    }
    resolved = true;
    const match = buffer.match(TAG_PATTERN);
    const rest = match ? buffer.slice(match[0].length) : buffer;
    if (rest) onClean(rest);
  };
}

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
