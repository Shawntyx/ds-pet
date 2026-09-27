import { BrowserWindow, globalShortcut } from 'electron';
import { loadSettings, updateSettings } from './config';

export function registerGlobalShortcuts(mainWindow: BrowserWindow, setVisible: (visible: boolean) => void): void {
  const settings = loadSettings();
  const ok = globalShortcut.register(settings.toggleShortcut, () => {
    const next = updateSettings({ visible: !loadSettings().visible });
    setVisible(next.visible);
  });
  if (!ok) {
    // eslint-disable-next-line no-console
    console.warn(`[快捷键] 注册 ${settings.toggleShortcut} 失败，可能被其他程序占用了`);
  }
}

export function unregisterAllShortcuts(): void {
  globalShortcut.unregisterAll();
}
