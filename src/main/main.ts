import { app, BrowserWindow, screen } from 'electron';
import * as path from 'path';

// 阶段 0：先跑起一个透明、无边框、置顶的空白窗口，后续阶段再往里面加桌宠内容。
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = 300;
  const windowHeight = 300;

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: screenWidth - windowWidth,
    y: screenHeight - windowHeight,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../../src/renderer/index.html'));

  // 阶段 1 会按角色像素区域做点击穿透，这里先整体保留鼠标事件方便调试。
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
