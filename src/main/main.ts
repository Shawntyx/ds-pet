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
    // 窗口从创建起就一直是"显示"状态，"隐藏"靠下面的 opacity 控制，不靠真的 hide()/show()——
    // 原因见 setVisible 那边的注释（真的 hide() 再 show() 回来，Windows 这边会有一个很难查的坑）。
    show: true,
    opacity: settings.visible ? 1 : 0,
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

  // 默认整窗点击穿透。forward:true 会让窗口继续收到 mousemove 转发给渲染进程，
  // 让它根据鼠标是不是在角色不透明像素上实时切换穿透/响应；但这只在"显示"状态下才需要——
  // 如果一开始就是隐藏的（opacity 0），不带 forward，彻底不转发任何鼠标事件，
  // 不然鼠标划过她原本所在的位置时，渲染进程会因为检测到"在不透明像素上"而把穿透关掉，
  // 导致一扇肉眼看不见的窗口其实在拦鼠标。见 setVisible 里对应的开关逻辑。
  window.setIgnoreMouseEvents(true, settings.visible ? { forward: true } : undefined);

  // 不能无条件 mainWindow = null：手动"重建窗口"时，新窗口早于旧窗口销毁完成就已经接管了
  // mainWindow，旧窗口销毁后触发的这个 closed 要是不管三七二十一就置空，会把刚装好的新窗口引用冲掉。
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
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

// "隐藏"不走真的 window.hide()/show()——实测（见诊断日志）发现一个很难查的 Windows/Electron
// 坑：这扇透明点击穿透窗口一旦真的 hide() 过一次，下次 show() 回来，鼠标左键按下（mousedown）
// 会彻底收不到了（mouseup/mousemove/右键菜单都完全正常，只有 mousedown 消失），导致点击和拖拽
// 失灵，具体是 Chromium/Windows 内部什么机制导致的没查清楚，但现象很确定、很好复现。
// 干脆不让这个"真的从 OS 层面隐藏再显示"的转换再发生：窗口从创建起永远是 show() 状态，
// "隐藏"改成把透明度降到 0 + 强制整窗穿透，视觉和交互上跟真隐藏没区别，但不会踩到这个坑。
// 提到模块顶层是因为 second-instance 处理器和 bootstrap() 里的托盘/快捷键/菜单都要共用同一份逻辑。
function setVisible(visible: boolean): void {
  if (!mainWindow) return;
  if (visible) {
    // 恢复 forward 转发：渲染进程才能继续收到 mousemove，按真实鼠标位置自己切换穿透/响应。
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    mainWindow.setOpacity(1);
    // 从隐藏状态召唤回来时，让她播一下打招呼动作（首次启动不用，renderer 自己的 init 会播）。
    sendToWindow(mainWindow, 'pet:shown');
  } else {
    // 不带 forward：彻底不转发任何鼠标事件给渲染进程，不然鼠标划过她原本所在的位置时，
    // 渲染进程会因为检测到"在不透明像素上"而把穿透关掉，导致看不见的窗口其实在拦鼠标。
    mainWindow.setIgnoreMouseEvents(true);
    mainWindow.setOpacity(0);
  }
}

if (!app.requestSingleInstanceLock()) {
  // 装了快捷方式以后很容易被点两下：拿不到锁就直接退出，
  // 不然会出现两只桌宠、两个托盘图标，还会互相抢全局快捷键。
  app.quit();
} else {
  // 已经有一个实例在跑：把她叫出来，而不是再开一个进程。
  app.on('second-instance', () => setVisible(true));
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
  wireMainWindow(mainWindow);

  createTray(setVisible, recreateMainWindow);
  registerGlobalShortcuts(mainWindow, setVisible);
  // 余额查完/查失败后重画托盘菜单，让那一行数字跟着更新。
  onBalanceChange(refreshTrayMenu);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      wireMainWindow(mainWindow);
    }
  });
}

/** 新建/重建窗口后都要跑的那一串初始化，提出来给 bootstrap、'activate'、
 *  托盘"重新创建桌宠窗口"三处共用，别每处抄一遍、改漏一处。 */
function wireMainWindow(window: BrowserWindow): void {
  registerIpcHandlers(window);
  initContextMenu(window, setVisible, recreateMainWindow);
  initChat(window);
  initSettings(window, setVisible);
  initBubble(window);
  initPetWindowModules(window);
}

// 实测踩到的坑（跟上面 setVisible 注释里那个不是一回事，但现象一样：mousedown 收不到，
// mouseup/mousemove/右键照常）：用户同时开着另一个也用"透明穿透+转发鼠标"技巧的桌宠类
// App（dsh-pet）时，它的窗口盖到这边上面会触发；关掉对方、甚至把对方整个进程退出都不会
// 自动恢复——但把咱们这只窗口销毁重建一个新的，立刻就好了。说明坏的状态卡在了这一个
// 窗口实例的底层（具体是什么没查清楚，两个独立 App 都搞"透明穿透"互相干扰到这个地步，
// 不是我们这边能单方面解决的），但只要重建窗口就能摆脱，不需要整个重启 App、不会丢
// 设置/聊天记录/长期记忆（那些都存在别处）。托盘菜单里放一个"重新创建桌宠窗口"，
// 中招时点一下比退出重开快得多。
function recreateMainWindow(): void {
  const oldWindow = mainWindow;
  mainWindow = createWindow();
  wireMainWindow(mainWindow);
  if (oldWindow && !oldWindow.isDestroyed()) oldWindow.destroy();
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
