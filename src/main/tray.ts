import { app, Menu, Tray, nativeImage } from 'electron';
import * as path from 'path';
import { loadSettings, updateSettings } from './config';
import { showSettingsWindow } from './settingsWindow';
import { formatBalanceBrief, getBalanceView, refreshBalance } from './balance';
import { whaleAssetsDir } from './paths';

let tray: Tray | null = null;
let onToggleVisibleRef: ((visible: boolean) => void) | null = null;
let onRecreateWindowRef: (() => void) | null = null;

/** 托盘菜单里的余额那一行；数字走和设置页/气泡同一个格式化函数，保证一致。 */
function balanceLabel(): string {
  const view = getBalanceView();
  if (view.total === null) {
    return `余额：${formatBalanceBrief(view)}（点击重试）`;
  }
  return `余额：${formatBalanceBrief(view)}${view.low ? '（偏低）' : ''}`;
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
      // 同时开着别的也用"透明穿透"技巧的桌宠类 App（比如 dsh-pet）时，两边会互相干扰，
      // 导致桌宠点击/拖拽失灵，且对方关掉也不会自动恢复——重建这扇窗口能立刻解决，
      // 不用整个重启 App（设置/聊天记录/长期记忆都存在别处，不会丢）。
      label: '重开（点击失灵时用）',
      click: () => onRecreateWindowRef?.(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
}

export function createTray(onToggleVisible: (visible: boolean) => void, onRecreateWindow: () => void): Tray {
  onToggleVisibleRef = onToggleVisible;
  onRecreateWindowRef = onRecreateWindow;
  // 打包后素材在 resources/whale-assets 里（见 paths.ts）
  const iconPath = path.join(whaleAssetsDir(), 'docs', 'images', 'logo.png');
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
