import { BrowserWindow, globalShortcut } from 'electron';
import { loadSettings, updateSettings } from './config';

export function registerGlobalShortcuts(mainWindow: BrowserWindow, setVisible: (visible: boolean) => void): void {
  // 设置里改快捷键后会重新调用这个函数，先清掉旧的注册，不然旧快捷键还留着、新快捷键也生效，两个都能触发。
  globalShortcut.unregisterAll();
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
