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
import { setWindowRect } from './windowRect';

// 气泡是独立的悬浮小窗口（不是画在桌宠窗口里的），跟着桌宠挪动、贴边自适应，
// 下面带一行输入框，不用开完整聊天面板也能回她一句。
//
// 两个约定（用户明确要的）：
//   * 默认显示 8 秒；但用户在这里回过话之后就一直留着，只能点右上角 × 关掉。
//   * 如果这条气泡是"她主动说话"，用户在下面回复时算**开启一段新对话**
//     （像常见 LLM 的"新对话"：上下文重置，但人设和长期记忆照旧）——
//     具体在 bubble:send-message 里通过 newConversation 交给 chatSession。

let bubbleWindow: BrowserWindow | null = null;
let petWindowRef: BrowserWindow | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
/** 用户在气泡里回过话了：这条气泡改成"一直留着"，只有点 × 才收起来。 */
let pinned = false;
/** 正在通过气泡流式回复：这期间也不该自动收起（不然回复看一半就没了）。 */
let streaming = false;
/** 已经挂过 'move' 监听的窗口，避免 initBubble 被反复调用时重复挂。 */
let moveListenerWindow: BrowserWindow | null = null;

/** 当前气泡上显示的是哪句"她主动说的话"（完整原文）；不是主动说话时为 null。
 *  用户在气泡里回复时用它来判断"要不要开一段新对话"。 */
let proactiveTextOnScreen: string | null = null;
/** 刚说出口、还没弹出来的主动说话。showBubbleOverlay 会把它接到 proactiveTextOnScreen 上。 */
let pendingProactiveText: string | null = null;

const BUBBLE_WIDTH = 220;
/** 气泡窗口高度是**跟着内容变的**（渲染进程量好高度报上来），下面两个是夹取范围。
 *  空文字时大约 79px（输入框 29 + 上下 padding 8 + 间距 6 + 气泡一行 36），所以下限给 80；
 *  上限 300 ≈ 气泡的 CSS max-height(240) 加输入框和留白，再多就靠气泡内部滚动。
 *  范围贴近真实内容高度，气泡才不会"飘"在离她很远的地方。 */
export const BUBBLE_MIN_HEIGHT = 80;
export const BUBBLE_MAX_HEIGHT = 300;
const DEFAULT_BUBBLE_HEIGHT = 130;
const GAP_PX = 8;
/** 默认显示 8 秒。用户回过话（pinned）或还在流式输出时不自动收。 */
const DEFAULT_BUBBLE_MS = 8000;

/** 当前内容需要的高度（渲染进程上报）。移动时不会改它——尺寸只在内容变化时变。 */
let contentHeight = DEFAULT_BUBBLE_HEIGHT;

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

/** 把渲染进程量出来的高度夹进合理区间（纯函数，见 tests/bubbleWindow.test.js）。 */
export function clampBubbleHeight(height: number): number {
  if (!Number.isFinite(height)) return DEFAULT_BUBBLE_HEIGHT;
  return Math.min(BUBBLE_MAX_HEIGHT, Math.max(BUBBLE_MIN_HEIGHT, Math.round(height)));
}

/** 主动说话（健康提醒/哲学问题/窗口吐槽/余额提醒）在弹气泡之前先登记一下原文，
 *  这样用户在气泡里回复时我们能知道"他回的是哪句主动说话"。 */
export function noteProactiveLine(text: string): void {
  pendingProactiveText = text || null;
}

/** 当前气泡是不是"她主动说的话"（要在气泡里开新对话时用）。 */
export function bubbleShowsProactiveLine(): boolean {
  return proactiveTextOnScreen !== null;
}

function createBubbleWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: BUBBLE_WIDTH,
    height: contentHeight,
    title: '气泡',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    // 高度要按内容调整，所以不能锁死 resizable；窗口没有边框，用户也拖不动它。
    // （尺寸稳定靠 windowRect.ts：每次移动都把尺寸一起 setBounds 回去。）
    resizable: true,
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
 * "角色实际画面"、屏幕工作区和**当前内容高度**喂给它：人物贴着左/右边缘时气泡会改摆到
 * 人物旁边，而不是被顶到屏幕外面去。
 */
function computeBubblePosition(): { x: number; y: number } {
  const anchor = petAnchorRect();
  const { workArea } = screen.getDisplayMatching(anchor);
  return placeBubble(anchor, workArea, { width: BUBBLE_WIDTH, height: contentHeight }, GAP_PX);
}

/**
 * 摆位：位置跟着她、**尺寸每次都按内容高度写死**。
 *
 * 为什么必须带尺寸（而不是只调 setPosition）：这台 Windows 上对透明窗口 setPosition
 * 会把窗口尺寸一起改掉（被移动的轴会变长），气泡就会越跟越宽——输入框是 width:100%，
 * 表现出来就是"回复框不断拉长"。每帧把尺寸设回去就锁住了，见 windowRect.ts。
 */
function applyBubbleBounds(): void {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return;
  const { x, y } = computeBubblePosition();
  setWindowRect(bubbleWindow, { x, y, width: BUBBLE_WIDTH, height: contentHeight });
}

function repositionIfVisible(): void {
  if (!bubbleWindow || bubbleWindow.isDestroyed() || !bubbleWindow.isVisible()) return;
  if (!petWindowRef) return;
  applyBubbleBounds();
}

export function initBubble(petWindow: BrowserWindow): void {
  petWindowRef = petWindow;
  // 桌宠走动/被拖/弹跳时跟着挪（只在气泡正显示的时候才会真的动）。
  if (moveListenerWindow !== petWindow) {
    petWindow.on('move', repositionIfVisible);
    moveListenerWindow = petWindow;
  }

  ipcMain.removeAllListeners('bubble:send-message');
  ipcMain.removeAllListeners('bubble:open-chat');
  ipcMain.removeAllListeners('bubble:close');
  ipcMain.removeAllListeners('bubble:resize');

  // 渲染进程量好"装下这段文字需要多高"再报上来：只有内容变化时会走这里，
  // 移动过程不会调，所以气泡不会一边跟着她跑一边变高变矮。
  ipcMain.on('bubble:resize', (_event, height: number) => {
    const next = clampBubbleHeight(height);
    if (next === contentHeight) return;
    contentHeight = next;
    applyBubbleBounds();
  });

  ipcMain.on('bubble:send-message', (_event, text: string) => {
    if (typeof text !== 'string' || !text.trim()) return;
    // 用户回话了：这条气泡不再自动收起，留在屏幕上等她回完、看完了自己点 × 。
    pinned = true;
    clearHideTimer();

    // 她刚才在这条气泡里主动说了话 → 用户这句算开启一段新对话，
    // 那句主动说话作为新对话的开头（它没进过聊天记录，见 proactive.ts）。
    const seedText = proactiveTextOnScreen;
    proactiveTextOnScreen = null;

    const relayDelta = createTagStrippingRelay((clean) =>
      sendToWindow(bubbleWindow, 'bubble:delta', clean)
    );
    streaming = true;
    sendUserMessage(
      text.trim(),
      {
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
      },
      seedText ? { newConversation: { seedText } } : undefined
    );
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
    proactiveTextOnScreen = null;
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
  // 这条气泡是不是"她主动说的话"由 noteProactiveLine 提前登记；用掉就清掉，
  // 免得后面一条聊天回复/互动气泡被误判成主动说话。
  proactiveTextOnScreen = pendingProactiveText;
  pendingProactiveText = null;

  const reveal = (): void => {
    win.webContents.send('bubble:set-text', text);
    // 先用当前高度定位显示（渲染进程量完新高度会发 bubble:resize 再调一次），
    // 这样出现的位置基本就是对的，不会先闪一下错位置。
    applyBubbleBounds();
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
