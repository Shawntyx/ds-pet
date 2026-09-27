import { BrowserWindow, screen } from 'electron';
import * as path from 'path';

// 之前气泡是画在桌宠窗口自己里面的（#bubble 用 translateY(-100%) 往上顶），
// 但桌宠窗口就只有角色那么大，上面完全没有多余空间——气泡其实从阶段 1 开始就一直被裁掉、
// 根本没显示过，摸头/摸尾巴/投喂等等所有交互的气泡都是这样。这里改成单独一个悬浮小窗口，
// 跟右键菜单/聊天窗口一样，不占用桌宠窗口本来的画面。

let bubbleWindow: BrowserWindow | null = null;
let petWindowRef: BrowserWindow | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const BUBBLE_WIDTH = 220;
const BUBBLE_HEIGHT = 90;

function createBubbleWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: BUBBLE_WIDTH,
    height: BUBBLE_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'bubblePreload.js'),
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/bubble.html'));
  return win;
}

/** 优先贴在桌宠正上方；上面放不下（比如贴着屏幕顶边）就放下面。 */
function positionNearPet(win: BrowserWindow): void {
  if (!petWindowRef) return;
  const petBounds = petWindowRef.getBounds();
  const { workArea } = screen.getDisplayMatching(petBounds);

  let x = petBounds.x + petBounds.width / 2 - BUBBLE_WIDTH / 2;
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - BUBBLE_WIDTH));

  let y = petBounds.y - BUBBLE_HEIGHT - 4;
  if (y < workArea.y) y = petBounds.y + petBounds.height + 4;

  win.setPosition(Math.round(x), Math.round(y));
}

export function initBubble(petWindow: BrowserWindow): void {
  petWindowRef = petWindow;
}

export function showBubbleOverlay(text: string, durationMs = 2200): void {
  if (!text) return;
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    bubbleWindow = createBubbleWindow();
  }
  const win = bubbleWindow;

  const reveal = (): void => {
    win.webContents.send('bubble:set-text', text);
    positionNearPet(win);
    win.showInactive(); // 不抢焦点，不打断用户正在别的窗口里打字
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', reveal);
  } else {
    reveal();
  }

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.hide();
  }, durationMs);
}
