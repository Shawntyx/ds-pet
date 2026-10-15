import { BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
import { loadSettings, updateSettings } from './config';
import { refreshTrayMenu } from './tray';
import { showChatWindow } from './chatWindow';
import { showSettingsWindow } from './settingsWindow';
import { petAnchorRect } from './petAnchor';
import { placeSidePanel } from './popupPlacement';
import { sendToWindow } from './safeSend';
import type { PetMenuAction } from '../shared/types';

const MENU_WIDTH = 168;
// 7 个菜单项 + 1 条分隔线 + 容器内边距，实测 268 会把最后一项裁掉一点，留够余量。
const MENU_HEIGHT = 320;

let menuWindow: BrowserWindow | null = null;
let petWindowRef: BrowserWindow | null = null;
let setVisibleRef: ((visible: boolean) => void) | null = null;

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

function showMenu(): void {
  if (!petWindowRef) return;
  if (!menuWindow || menuWindow.isDestroyed()) {
    menuWindow = createMenuWindow();
  }

  // 摆位交给 popupPlacement（有测试）：人物贴右边时菜单会自己翻到左边，上下也会夹进工作区。
  const anchor = petAnchorRect();
  const { workArea } = screen.getDisplayMatching(anchor);
  const { x, y } = placeSidePanel(anchor, workArea, { width: MENU_WIDTH, height: MENU_HEIGHT });

  menuWindow.setPosition(Math.round(x), Math.round(y));

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
  const petActions: PetMenuAction[] = ['feed', 'poke', 'praise'];
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
    case 'settings':
      showSettingsWindow();
      break;
  }
}

export function initContextMenu(petWindow: BrowserWindow, setVisible: (visible: boolean) => void): void {
  petWindowRef = petWindow;
  setVisibleRef = setVisible;

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
