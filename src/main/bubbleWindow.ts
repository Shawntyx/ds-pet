import { BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
import { createTagStrippingRelay, sendUserMessage } from './chatSession';
import { petAnchorRect } from './petAnchor';
import { placeBubble } from './popupPlacement';

// 之前气泡是画在桌宠窗口自己里面的（#bubble 用 translateY(-100%) 往上顶），
// 但桌宠窗口就只有角色那么大，上面完全没有多余空间——气泡其实从阶段 1 开始就一直被裁掉、
// 根本没显示过，摸头/摸尾巴/投喂等等所有交互的气泡都是这样。这里改成单独一个悬浮小窗口，
// 跟右键菜单/聊天窗口一样，不占用桌宠窗口本来的画面；而且会跟着桌宠挪动、贴边自适应，
// 下面还带一行输入框，不用开完整聊天面板也能回她一句。

let bubbleWindow: BrowserWindow | null = null;
let petWindowRef: BrowserWindow | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const BUBBLE_WIDTH = 220;
const BUBBLE_HEIGHT = 130; // 上面文字区 + 下面一行输入框
const GAP_PX = 8;

function createBubbleWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: BUBBLE_WIDTH,
    height: BUBBLE_HEIGHT,
    title: '气泡',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    // 要能点进输入框打字，所以不能像菜单/桌宠本体那样整体 focusable:false；
    // 用 showInactive() 弹出时不抢焦点，只有用户真的点了输入框才会拿到焦点。
    focusable: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'bubblePreload.js'),
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/bubble.html'));

  // 用户点进输入框、窗口拿到焦点了：说明在互动，先别自动收起。
  win.on('focus', () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  });
  // 点到别的地方去、窗口失焦：收起气泡（被动弹出的气泡从没拿到过焦点，不会走这条路，
  // 走的是下面 showBubbleOverlay 里设的定时器）。
  win.on('blur', () => {
    win.hide();
  });

  return win;
}

/**
 * 算气泡该放哪。位置逻辑在 popupPlacement.ts 里（纯函数、有测试），这里只负责把
 * "角色实际画面"和屏幕工作区喂给它：人物贴着左/右边缘时气泡会改摆到人物旁边，
 * 而不是被顶到屏幕外面去。
 */
function computeBubblePosition(): { x: number; y: number } {
  const anchor = petAnchorRect();
  const { workArea } = screen.getDisplayMatching(anchor);
  return placeBubble(anchor, workArea, { width: BUBBLE_WIDTH, height: BUBBLE_HEIGHT }, GAP_PX);
}

function repositionIfVisible(): void {
  if (!bubbleWindow || bubbleWindow.isDestroyed() || !bubbleWindow.isVisible()) return;
  if (!petWindowRef) return;
  const { x, y } = computeBubblePosition();
  bubbleWindow.setPosition(x, y);
}

export function initBubble(petWindow: BrowserWindow): void {
  petWindowRef = petWindow;
  // 桌宠走动/被拖/弹跳时持续跟着挪（只在气泡正显示的时候才会真的动，见 repositionIfVisible）。
  petWindow.on('move', repositionIfVisible);

  ipcMain.removeAllListeners('bubble:send-message');
  ipcMain.removeAllListeners('bubble:open-chat');

  ipcMain.on('bubble:send-message', (_event, text: string) => {
    if (typeof text !== 'string' || !text.trim()) return;
    const win = bubbleWindow;
    const relayDelta = createTagStrippingRelay((clean) => win?.webContents.send('bubble:delta', clean));
    sendUserMessage(text.trim(), {
      onThinkingStart: () => petWindowRef?.webContents.send('pet:thinking-start'),
      onDelta: (delta) => relayDelta(delta),
      onDone: (payload) => {
        win?.webContents.send('bubble:done');
        // 回复本来就在气泡里流式显示出来了，不用再弹一次气泡——只让桌宠换个表情。
        petWindowRef?.webContents.send('pet:reply', { ...payload, bubble: false });
      },
      onError: (message) => win?.webContents.send('bubble:error', message),
    });
  });

  ipcMain.on('bubble:open-chat', () => {
    // 避免循环 import：这里才临时 require，chatWindow.ts 不需要知道气泡窗口的存在。
    const { showChatWindow } = require('./chatWindow');
    showChatWindow();
    bubbleWindow?.hide();
  });
}

export function showBubbleOverlay(text: string, durationMs = 3500): void {
  if (!text) return;
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    bubbleWindow = createBubbleWindow();
  }
  const win = bubbleWindow;

  const reveal = (): void => {
    win.webContents.send('bubble:set-text', text);
    const { x, y } = computeBubblePosition();
    win.setPosition(x, y);
    win.showInactive(); // 不抢焦点，不打断用户正在别的窗口里打字
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', reveal);
  } else {
    reveal();
  }

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (bubbleWindow && !bubbleWindow.isDestroyed() && !bubbleWindow.isFocused()) {
      bubbleWindow.hide();
    }
  }, durationMs);
}
