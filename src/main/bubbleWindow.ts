import { BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
import {
  cancelCurrentRequest,
  createTagStrippingRelay,
  isChatBusy,
  sendUserMessage,
} from './chatSession';
import { petAnchorRect } from './petAnchor';
import { placeBubble } from './popupPlacement';
import { isWindowVisible, sendToWindow } from './safeSend';

// 之前气泡是画在桌宠窗口自己里面的（#bubble 用 translateY(-100%) 往上顶），
// 但桌宠窗口就只有角色那么大，上面完全没有多余空间——气泡其实从阶段 1 开始就一直被裁掉、
// 根本没显示过，摸头/摸尾巴/投喂等等所有交互的气泡都是这样。这里改成单独一个悬浮小窗口，
// 跟右键菜单/聊天窗口一样，不占用桌宠窗口本来的画面；而且会跟着桌宠挪动、贴边自适应，
// 下面还带一行输入框，不用开完整聊天面板也能回她一句。

let bubbleWindow: BrowserWindow | null = null;
let petWindowRef: BrowserWindow | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
/** 用户在气泡里回过话了：这条气泡改成"一直留着"，只有点 × 才收起来。 */
let pinned = false;
/** 正在通过气泡流式回复：这期间也不该自动收起（不然回复看一半就没了）。 */
let streaming = false;

const BUBBLE_WIDTH = 220;
const BUBBLE_HEIGHT = 130; // 上面文字区 + 下面一行输入框
const GAP_PX = 8;
/** 默认显示 8 秒。用户回过话（pinned）或还在流式输出时不自动收。 */
const DEFAULT_BUBBLE_MS = 8000;

/**
 * 现在该不该自动收起气泡？（纯函数，见 tests/bubbleWindow.test.js）
 * 三种情况都不收：用户回过话、还在流式回复、鼠标/焦点正停在气泡里（比如正在打字）。
 */
export function shouldAutoHide(state: {
  pinned: boolean;
  streaming: boolean;
  focused: boolean;
}): boolean {
  return !state.pinned && !state.streaming && !state.focused;
}

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
  win.on('focus', () => clearHideTimer());
  // 点到别的地方去、窗口失焦：收起气泡。但"她刚回过话"（pinned）和"正在回复中"（streaming）
  // 不算——用户很可能正等着看回复。
  win.on('blur', () => {
    if (shouldAutoHide({ pinned, streaming, focused: false })) win.hide();
  });

  return win;
}

function clearHideTimer(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
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
  ipcMain.removeAllListeners('bubble:close');

  ipcMain.on('bubble:send-message', (_event, text: string) => {
    if (typeof text !== 'string' || !text.trim()) return;
    // 用户回话了：这条气泡不再自动收起，留在屏幕上等她回完、看完了自己点 × 。
    pinned = true;
    clearHideTimer();

    const relayDelta = createTagStrippingRelay((clean) =>
      sendToWindow(bubbleWindow, 'bubble:delta', clean)
    );
    streaming = true;
    sendUserMessage(text.trim(), {
      onThinkingStart: () => sendToWindow(petWindowRef, 'pet:thinking-start'),
      onDelta: (delta) => relayDelta(delta),
      onDone: (payload) => {
        streaming = false;
        sendToWindow(bubbleWindow, 'bubble:done');
        // 回复本来就在气泡里流式显示出来了，不用再弹一次气泡——只让桌宠换个表情。
        sendToWindow(petWindowRef, 'pet:reply', { ...payload, bubble: false });
      },
      onStopped: (payload) => {
        streaming = false;
        sendToWindow(bubbleWindow, 'bubble:stopped', payload);
        if (payload) {
          sendToWindow(petWindowRef, 'pet:reply', { ...payload, bubble: false });
        }
      },
      onError: (message) => {
        streaming = false;
        sendToWindow(bubbleWindow, 'bubble:error', message);
      },
    });
  });

  ipcMain.on('bubble:open-chat', () => {
    // 避免循环 import：这里才临时 require，chatWindow.ts 不需要知道气泡窗口的存在。
    const { showChatWindow } = require('./chatWindow');
    showChatWindow();
    bubbleWindow?.hide();
  });

  // 点 × ：收起气泡。如果她还在回，就顺手把请求也停了——用户已经把气泡关掉了，
  // 让它继续在后台跑只会把"一轮请求"的锁占住，别的窗口就发不出消息了。
  ipcMain.on('bubble:close', () => {
    if (streaming && isChatBusy()) cancelCurrentRequest();
    streaming = false;
    pinned = false;
    clearHideTimer();
    bubbleWindow?.hide();
  });
}

export function showBubbleOverlay(text: string, durationMs = DEFAULT_BUBBLE_MS): void {
  if (!text) return;
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    bubbleWindow = createBubbleWindow();
  }
  const win = bubbleWindow;

  // 新气泡进来：先回到"会自动收起"的状态（除非用户马上又回了一句）。
  pinned = false;

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

  clearHideTimer();
  hideTimer = setTimeout(() => {
    if (!bubbleWindow || bubbleWindow.isDestroyed()) return;
    if (shouldAutoHide({ pinned, streaming, focused: bubbleWindow.isFocused() })) {
      bubbleWindow.hide();
    }
  }, durationMs);
}
