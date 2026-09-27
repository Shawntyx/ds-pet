import { BrowserWindow, ipcMain, screen } from 'electron';
import { loadSettings } from './config';

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // 渲染进程做完像素透明度检测后，告诉主进程要不要让鼠标事件穿透窗口。
  // forward=true 时即使穿透也继续收到 mousemove，这样渲染进程能持续检测光标是否移回角色身上。
  ipcMain.on('pet:set-ignore-mouse-events', (_event, ignore: boolean, forward: boolean) => {
    mainWindow.setIgnoreMouseEvents(ignore, { forward });
  });

  ipcMain.on('pet:set-window-position', (_event, x: number, y: number) => {
    mainWindow.setPosition(x, y, false);
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
