import { BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
import { loadSettings, updateSettings } from './config';
import { refreshTrayMenu } from './tray';
import { showChatWindow } from './chatWindow';
import { showSettingsWindow } from './settingsWindow';
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

  const petBounds = petWindowRef.getBounds();
  const { workArea } = screen.getDisplayMatching(petBounds);

  let x = petBounds.x + petBounds.width + 8;
  if (x + MENU_WIDTH > workArea.x + workArea.width) {
    x = petBounds.x - MENU_WIDTH - 8;
  }
  let y = petBounds.y;
  if (y + MENU_HEIGHT > workArea.y + workArea.height) {
    y = workArea.y + workArea.height - MENU_HEIGHT;
  }
  if (y < workArea.y) y = workArea.y;

  menuWindow.setPosition(Math.round(x), Math.round(y));

  const show = (): void => {
    if (!menuWindow) return;
    menuWindow.webContents.send('menu:init', { doNotDisturb: loadSettings().doNotDisturb });
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
    petWindowRef.webContents.send('pet:trigger-action', actionId as PetMenuAction);
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
