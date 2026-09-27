import { BrowserWindow, ipcMain, screen } from 'electron';
import { loadSettings } from './config';
import { showBubbleOverlay } from './bubbleWindow';

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // 窗口在 'activate' 时可能被重建，这里先清掉旧监听，避免 ipcMain.handle 重复注册报错。
  ipcMain.removeAllListeners('pet:set-ignore-mouse-events');
  ipcMain.removeAllListeners('pet:set-window-position');
  ipcMain.removeAllListeners('pet:show-bubble');
  ipcMain.removeHandler('pet:get-window-position');
  ipcMain.removeHandler('pet:get-work-area');
  ipcMain.removeHandler('pet:get-sprite-size');

  // 渲染进程做完像素透明度检测后，告诉主进程要不要让鼠标事件穿透窗口。
  // forward=true 时即使穿透也继续收到 mousemove，这样渲染进程能持续检测光标是否移回角色身上。
  ipcMain.on('pet:set-ignore-mouse-events', (_event, ignore: boolean, forward: boolean) => {
    mainWindow.setIgnoreMouseEvents(ignore, { forward });
  });

  ipcMain.on('pet:set-window-position', (_event, x: number, y: number) => {
    mainWindow.setPosition(x, y, false);
  });

  ipcMain.on('pet:show-bubble', (_event, text: string) => {
    showBubbleOverlay(text);
  });

  ipcMain.handle('pet:get-window-position', () => {
    const [x, y] = mainWindow.getPosition();
    return { x, y };
  });

  ipcMain.handle('pet:get-work-area', () => {
    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    return display.workArea;
  });

  ipcMain.handle('pet:get-sprite-size', () => {
    return loadSettings().spriteSize;
  });
}
