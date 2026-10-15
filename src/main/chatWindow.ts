import { BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
import {
  cancelCurrentRequest,
  createTagStrippingRelay,
  getHistory,
  sendUserMessage,
} from './chatSession';
import { petAnchorRect } from './petAnchor';
import { placeSidePanel } from './popupPlacement';
import { isWindowVisible, sendToWindow } from './safeSend';
import { moveWindowTo } from './windowRect';
import { startNewConversation } from './chatStore';
import type { ChatMessageView } from '../shared/types';

let chatWindow: BrowserWindow | null = null;
let petWindowRef: BrowserWindow | null = null;
/** 聊天面板关闭时，把这句话用气泡显示在桌宠头上（SPEC 5.2："关闭后桌宠头上用气泡显示最新一句"）。 */
let lastReply: { text: string; emotion: string | null } | null = null;

function historyView(): ChatMessageView[] {
  return getHistory().map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
    conversation: m.conversation,
  }));
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
    // 关面板时如果这一轮已经回完了，就把最后一句用气泡补上。
    if (lastReply) {
      sendToWindow(petWindowRef, 'pet:reply', lastReply);
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
  // 走 moveWindowTo：它会带着当前尺寸一起 setBounds——只调 setPosition 会抛异常/改尺寸。
  moveWindowTo(win, x, y);
}

/** 聊天面板现在是不是开着——开着的时候不再弹气泡（文本就在面板里，弹了是重复的）。 */
export function isChatWindowOpen(): boolean {
  return isWindowVisible(chatWindow);
}

export function showChatWindow(): void {
  if (!chatWindow || chatWindow.isDestroyed()) {
    chatWindow = createChatWindow();
  }
  // 只在打开的时候摆一次位置（挨着她）。之后她走动/被拖走，面板都待在原地不动：
  // 跟着她跑、还会在屏幕左右两边来回翻，反而看不清在聊什么。
  positionNearPet(chatWindow);
  chatWindow.show();
  chatWindow.focus();
}

export function initChat(petWindow: BrowserWindow): void {
  petWindowRef = petWindow;

  ipcMain.removeHandler('chat:get-history');
  ipcMain.removeAllListeners('chat:send-message');
  ipcMain.removeAllListeners('chat:cancel');
  ipcMain.removeAllListeners('chat:new-conversation');

  ipcMain.handle('chat:get-history', () => historyView());

  // 用户点"新对话"：换一段干净的上下文（人设和长期记忆照旧注入，所以她还是记得你）。
  ipcMain.on('chat:new-conversation', () => {
    startNewConversation();
    // 上一段对话的最后一句不该在新对话里再弹成气泡。
    lastReply = null;
  });

  ipcMain.on('chat:cancel', () => {
    cancelCurrentRequest();
  });

  ipcMain.on('chat:send-message', (_event, text: string) => {
    if (typeof text !== 'string' || !text.trim()) return;
    // 这里不用捕获窗口引用去发消息：面板可能在流式过程中被关掉，
    // 每次发送都用 sendToWindow 现查一遍窗口还在不在。
    const relayDelta = createTagStrippingRelay((clean) =>
      sendToWindow(chatWindow, 'chat:delta', clean)
    );

    sendUserMessage(text.trim(), {
      onThinkingStart: () => {
        sendToWindow(petWindowRef, 'pet:thinking-start');
      },
      onDelta: (delta) => {
        relayDelta(delta);
      },
      onDone: (payload) => {
        lastReply = payload;
        const panelOpen = isWindowVisible(chatWindow);
        sendToWindow(chatWindow, 'chat:done');
        // 面板还开着就只换表情（文本在面板里）；已经关掉了就改用气泡把这句话补给她，
        // 不然"回复打到一半关掉面板"就会静悄悄地什么都没看到。
        sendToWindow(petWindowRef, 'pet:reply', { ...payload, bubble: !panelOpen });
      },
      onStopped: (payload) => {
        const panelOpen = isWindowVisible(chatWindow);
        sendToWindow(chatWindow, 'chat:stopped', payload);
        if (!payload) return; // 一个字都没收到，没有可显示的内容
        lastReply = payload;
        sendToWindow(petWindowRef, 'pet:reply', { ...payload, bubble: !panelOpen });
      },
      onError: (message) => {
        sendToWindow(chatWindow, 'chat:error', message);
      },
    });
  });
}
