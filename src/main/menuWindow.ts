import { app, BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
import { loadSettings, updateSettings } from './config';
import { announceBalance } from './balance';
import { refreshTrayMenu } from './tray';
import { showChatWindow } from './chatWindow';
import { showSettingsWindow } from './settingsWindow';
import { petAnchorRect } from './petAnchor';
import { placeSidePanel } from './popupPlacement';
import { sendToWindow } from './safeSend';
import { setWindowRect } from './windowRect';
import type { PetMenuAction } from '../shared/types';

const MENU_WIDTH = 168;
// 9 个菜单项 + 2 条分隔线 + 容器内边距；加一项就要往上加高度，不然最后一项会被裁掉。
const MENU_HEIGHT = 390;

let menuWindow: BrowserWindow | null = null;
let petWindowRef: BrowserWindow | null = null;
let recreateWindowRef: (() => void) | null = null;
let setVisibleRef: ((visible: boolean) => void) | null = null;
/** 已经挂过 'move' 监听的窗口，避免 initContextMenu 被反复调用时重复挂（会一次移动触发多次摆位）。 */
let moveListenerWindow: BrowserWindow | null = null;

function createMenuWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: MENU_WIDTH,
    height: MENU_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'menuPreload.js'),
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/menu.html'));
  // 点到菜单外面（菜单窗口失去焦点）就收起菜单，模拟原生右键菜单的行为。
  win.on('blur', hideMenu);
  return win;
}

/** 按"角色实际画面"算菜单该摆哪（打开时和她在移动时都用这个）。 */
function positionMenu(): void {
  if (!menuWindow || menuWindow.isDestroyed()) return;
  // 摆位交给 popupPlacement（有测试）：人物贴右边时菜单会自己翻到左边，上下也会夹进工作区。
  const anchor = petAnchorRect();
  const { workArea } = screen.getDisplayMatching(anchor);
  const { x, y } = placeSidePanel(anchor, workArea, { width: MENU_WIDTH, height: MENU_HEIGHT });
  // 尺寸一起写死：只调 setPosition 会让透明窗口在移动时被改尺寸（见 windowRect.ts）。
  setWindowRect(menuWindow, { x, y, width: MENU_WIDTH, height: MENU_HEIGHT });
}

/** 菜单开着的时候她走开了：菜单跟着挪，不然就会孤零零留在原地指向空气。 */
function followPet(): void {
  if (!menuWindow || menuWindow.isDestroyed() || !menuWindow.isVisible()) return;
  positionMenu();
}

function showMenu(): void {
  if (!petWindowRef) return;
  if (!menuWindow || menuWindow.isDestroyed()) {
    menuWindow = createMenuWindow();
  }

  positionMenu();

  const show = (): void => {
    if (!menuWindow) return;
    sendToWindow(menuWindow, 'menu:init', { doNotDisturb: loadSettings().doNotDisturb });
    menuWindow.show();
    menuWindow.focus();
  };
  if (menuWindow.webContents.isLoading()) {
    menuWindow.webContents.once('did-finish-load', show);
  } else {
    show();
  }
}

function hideMenu(): void {
  if (menuWindow && !menuWindow.isDestroyed()) {
    menuWindow.hide();
  }
}

function handleAction(actionId: string): void {
  if (!petWindowRef) return;
  const petActions: PetMenuAction[] = ['feed', 'praise'];
  if ((petActions as string[]).includes(actionId)) {
    sendToWindow(petWindowRef, 'pet:trigger-action', actionId as PetMenuAction);
    return;
  }
  switch (actionId) {
    case 'dnd':
      updateSettings({ doNotDisturb: !loadSettings().doNotDisturb });
      refreshTrayMenu();
      break;
    case 'hide':
      setVisibleRef?.(false);
      break;
    case 'chat':
      showChatWindow();
      break;
    case 'balance':
      // 现查一次余额，让她冒个气泡说出来（数字走和设置页/托盘同一个格式化函数）。
      void announceBalance();
      break;
    case 'settings':
      showSettingsWindow();
      break;
    case 'quit':
      app.quit();
      break;
    case 'recreate':
      recreateWindowRef?.();
      break;
  }
}

export function initContextMenu(
  petWindow: BrowserWindow,
  setVisible: (visible: boolean) => void,
  recreateWindow: () => void
): void {
  petWindowRef = petWindow;
  setVisibleRef = setVisible;
  recreateWindowRef = recreateWindow;

  if (moveListenerWindow !== petWindow) {
    petWindow.on('move', followPet);
    moveListenerWindow = petWindow;
  }

  ipcMain.removeAllListeners('pet:request-context-menu');
  ipcMain.removeAllListeners('menu:action');
  ipcMain.removeAllListeners('menu:close');

  ipcMain.on('pet:request-context-menu', showMenu);
  ipcMain.on('menu:action', (_event, actionId: string) => {
    hideMenu();
    handleAction(actionId);
  });
  ipcMain.on('menu:close', hideMenu);
}
