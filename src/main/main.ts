import { app, BrowserWindow, screen } from 'electron';
import * as path from 'path';
import { loadSettings } from './config';
import { registerIpcHandlers } from './ipc';
import { createTray, refreshTrayMenu } from './tray';
import { initContextMenu } from './menuWindow';
import { initChat } from './chatWindow';
import { initSettings } from './settingsWindow';
import { initBubble } from './bubbleWindow';
import { initProactive, stopProactive } from './proactive';
import { initPresence, stopPresence } from './presence';
import { initBalance, onBalanceChange, stopBalance } from './balance';
import { flushChatStore, initChatStore } from './chatStore';
import { registerGlobalShortcuts, unregisterAllShortcuts } from './shortcuts';

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const settings = loadSettings();
  const size = settings.spriteSize;
  const { workArea } = screen.getPrimaryDisplay();
  const x = workArea.x + workArea.width - size - 40;
  const y = workArea.y + workArea.height - size;

  const window = new BrowserWindow({
    width: size,
    height: size,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    // 聊天面板（阶段 2）需要键盘输入，会用单独的可聚焦窗口；
    // 桌宠本体窗口不需要抢输入焦点，免得打断用户在别的应用里打字。
    focusable: false,
    show: settings.visible,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // preload 里要用 path/url 拼素材文件路径；Electron 默认的沙盒化 preload
      // 只放行几个内置模块，没有 path，所以这里关掉 preload 的沙盒。
      // 渲染进程本身仍然没有 nodeIntegration，安全边界没变。
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  window.loadFile(path.join(__dirname, '../renderer/index.html'));

  // 默认整窗点击穿透，渲染进程会在鼠标移到角色不透明像素上时临时关闭穿透。
  window.setIgnoreMouseEvents(true, { forward: true });

  window.on('closed', () => {
    mainWindow = null;
  });

  return window;
}

/** 依赖桌宠窗口的那几个模块（主动说话/空闲姿势/余额提醒）统一在这里启动，activate 重建窗口时也要再跑一遍。 */
function initPetWindowModules(window: BrowserWindow): void {
  initProactive(window);
  initPresence(window);
  initBalance(window);
}

app.whenReady().then(() => {
  // 聊天记录要在任何窗口用到历史之前读回来（app ready 之后才拿得到 userData 路径）。
  initChatStore();
  mainWindow = createWindow();
  registerIpcHandlers(mainWindow);

  const setVisible = (visible: boolean): void => {
    if (!mainWindow) return;
    if (visible) {
      mainWindow.show();
      // 从隐藏状态召唤回来时，让她播一下打招呼动作（首次启动不用，renderer 自己的 init 会播）。
      mainWindow.webContents.send('pet:shown');
    } else {
      mainWindow.hide();
    }
  };

  createTray(setVisible);
  registerGlobalShortcuts(mainWindow, setVisible);
  initContextMenu(mainWindow, setVisible);
  initChat(mainWindow);
  initSettings(mainWindow, setVisible);
  initBubble(mainWindow);
  initPetWindowModules(mainWindow);
  // 余额查完/查失败后重画托盘菜单，让那一行数字跟着更新。
  onBalanceChange(refreshTrayMenu);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      registerIpcHandlers(mainWindow);
      initContextMenu(mainWindow, setVisible);
      initChat(mainWindow);
      initSettings(mainWindow, setVisible);
      initBubble(mainWindow);
      initPetWindowModules(mainWindow);
    }
  });
});

app.on('window-all-closed', () => {
  // 托盘常驻应用：所有窗口关闭也不退出进程，退出只走托盘菜单的"退出"。
});

app.on('will-quit', () => {
  unregisterAllShortcuts();
  stopProactive();
  stopPresence();
  stopBalance();
  // 聊天记录是防抖写入的，退出前强制落盘，别丢最后几句。
  flushChatStore();
});
