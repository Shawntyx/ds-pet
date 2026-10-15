import { app, Menu, Tray, nativeImage } from 'electron';
import * as path from 'path';
import { loadSettings, updateSettings } from './config';
import { showSettingsWindow } from './settingsWindow';
import { currencySymbol, getBalanceView, refreshBalance } from './balance';

let tray: Tray | null = null;
let onToggleVisibleRef: ((visible: boolean) => void) | null = null;

/** 托盘菜单里的余额那一行：查到过就显示数字，没查到就显示原因（点一下重试）。 */
function balanceLabel(): string {
  const view = getBalanceView();
  if (view.total !== null) {
    const symbol = currencySymbol(view.currency);
    return `余额：${symbol}${view.total.toFixed(2)}${view.low ? '（偏低）' : ''}`;
  }
  if (view.error) return `余额：${view.error}`;
  return '余额：还没查到';
}

function rebuildMenu(): void {
  if (!tray) return;
  const settings = loadSettings();
  const menu = Menu.buildFromTemplate([
    {
      label: settings.visible ? '隐藏' : '显示',
      click: () => {
        const next = updateSettings({ visible: !settings.visible });
        onToggleVisibleRef?.(next.visible);
        rebuildMenu();
      },
    },
    {
      label: '设置',
      click: () => showSettingsWindow(),
    },
    { type: 'separator' },
    // 余额放在托盘里：不用打开设置也能随手看到，点一下就是手动刷新一次。
    {
      label: balanceLabel(),
      click: () => void refreshBalance(),
    },
    { type: 'separator' },
    {
      label: '勿扰模式（暂停主动说话）',
      type: 'checkbox',
      checked: settings.doNotDisturb,
      click: () => {
        updateSettings({ doNotDisturb: !settings.doNotDisturb });
        rebuildMenu();
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
}

export function createTray(onToggleVisible: (visible: boolean) => void): Tray {
  onToggleVisibleRef = onToggleVisible;
  const iconPath = path.join(__dirname, '../../assets/whale/docs/images/logo.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('鲸鱼娘桌宠');
  rebuildMenu();
  return tray;
}

/** 桌宠右键菜单里改了勿扰/隐藏状态后，调用这个让托盘菜单下次打开时显示最新状态。 */
export function refreshTrayMenu(): void {
  rebuildMenu();
}
