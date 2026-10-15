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
import { initPetAnchor } from './petAnchor';
import { sendToWindow } from './safeSend';
import { flushChatStore, initChatStore } from './chatStore';
import { flushMemoryStore, initMemoryStore } from './memory';
import { registerGlobalShortcuts, unregisterAllShortcuts } from './shortcuts';
import { logFilePath, logLine, setupLogging } from './appLog';
import { whaleAssetsDir } from './paths';
import { apiKeyStatus } from './secrets';

let mainWindow: BrowserWindow | null = null;

// 固定应用名。userData 目录是按这个名字算的（%APPDATA%\whale-pet），
// 而安装包的产品名是中文（快捷方式显示"鲸鱼娘桌宠"）——如果让它参与算 userData，
// 打包版就会去读一个空的新目录，你的 API Key、设置、聊天记录、记忆会"凭空消失"
// （而且会重新出现"没有 API Key"那个坑）。这里钉死，开发版和打包版共用同一份数据。
app.setName('whale-pet');

// 主进程出现未捕获异常 / 未处理的 Promise 拒绝时，Electron 默认会弹一个
// "A JavaScript error occurred in the main process" 对话框：用户只看到一个打断他的弹窗，
// 而我们拿不到堆栈（实测踩过一次，只能靠临时加日志才查到原因）。
// 桌面宠物是常驻程序，静默记日志比弹窗更合适：控制台一份，文件一份（打包版没有终端，只能看文件）。
setupLogging();

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
      // 桌面宠物必须一直在动（待机动画、走路、抛出物理都跑在 requestAnimationFrame 上）。
      // 默认的背景节流会在窗口被完全遮挡/移出可视区域时把 rAF 掐掉——实测踩到过：
      // 把她往上甩出屏幕后物理循环直接冻住，她永远停在半空（见 pet.ts startThrow 的上边界处理）。
      backgroundThrottling: false,
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

/** 依赖桌宠窗口的那几个模块（主动说话/空闲姿势/余额提醒/画面锚点）统一在这里启动，
 * activate 重建窗口时也要再跑一遍。 */
function initPetWindowModules(window: BrowserWindow): void {
  initPetAnchor(window);
  initProactive(window);
  initPresence(window);
  initBalance(window);
}

if (!app.requestSingleInstanceLock()) {
  // 装了快捷方式以后很容易被点两下：拿不到锁就直接退出，
  // 不然会出现两只桌宠、两个托盘图标，还会互相抢全局快捷键。
  app.quit();
} else {
  // 已经有一个实例在跑：把她叫出来，而不是再开一个进程。
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      sendToWindow(mainWindow, 'pet:shown');
    }
  });
  app.whenReady().then(bootstrap);
}

function bootstrap(): void {
  // 聊天记录和长期记忆要在任何窗口用到之前读回来（app ready 之后才拿得到 userData 路径）。
  initChatStore();
  initMemoryStore();
  // 打一行数据目录：排查"Key/设置/记录去哪了"这类问题时一眼就能看到，
  // 也能确认打包版和开发版用的是同一份数据（见上面 app.setName 的说明）。
  console.log('[whale-pet] userData:', app.getPath('userData'));
  // 打包版没有终端，这些信息一律同时写进日志文件，出问题时看 %APPDATA%\whale-pet\logs\app.log
  logLine(
    `启动 v${app.getVersion()} | 打包版=${app.isPackaged} | userData=${app.getPath('userData')} | ` +
      `素材目录=${whaleAssetsDir()} | API Key 状态=${apiKeyStatus().state}`
  );
  mainWindow = createWindow();
  registerIpcHandlers(mainWindow);

  const setVisible = (visible: boolean): void => {
    if (!mainWindow) return;
    if (visible) {
      mainWindow.show();
      // 从隐藏状态召唤回来时，让她播一下打招呼动作（首次启动不用，renderer 自己的 init 会播）。
      sendToWindow(mainWindow, 'pet:shown');
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
}

app.on('window-all-closed', () => {
  // 托盘常驻应用：所有窗口关闭也不退出进程，退出只走托盘菜单的"退出"。
});

app.on('will-quit', () => {
  logLine(`退出（日志文件：${logFilePath() ?? '不可用'}）`);
  unregisterAllShortcuts();
  stopProactive();
  stopPresence();
  stopBalance();
  // 聊天记录和长期记忆都是防抖写入的，退出前强制落盘，别丢最后几句/最后几条。
  flushChatStore();
  flushMemoryStore();
});
