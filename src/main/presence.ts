import { BrowserWindow, powerMonitor } from 'electron';
import { loadSettings } from './config';
import type { PresenceState } from '../shared/types';

// ASSETS.md §1：afk = 趴在课桌上睡（用户长时间无操作），sleep = 坐着闭眼睡（深夜）。
//
// "用户多久没动了"只有主进程拿得到（Electron 的 powerMonitor.getSystemIdleTime()，返回秒），
// 所以判定放这边，渲染进程只负责换姿势，不用自己猜用户走没走开。
// 5 秒轮询：阈值是分钟级的，再灵敏也没意义；只在状态真的变化时才发消息，不打扰渲染进程。

const POLL_MS = 5_000;
const NIGHT_START_HOUR = 23;
const NIGHT_END_HOUR = 6;

let petWindowRef: BrowserWindow | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let current: PresenceState = 'active';

function decide(): PresenceState {
  // 用户在设置里可能填 0 或者负数，兜一个下限，免得 0 分钟导致一起来就趴下。
  const thresholdSec = Math.max(1, loadSettings().afkAfterMinutes) * 60;
  if (powerMonitor.getSystemIdleTime() < thresholdSec) return 'active';
  const hour = new Date().getHours();
  // 深夜走开算"睡了"（坐着闭眼睡），白天走开算"趴在桌上"。
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR ? 'sleep' : 'afk';
}

function tick(): void {
  const next = decide();
  if (next === current) return;
  current = next;
  if (petWindowRef && !petWindowRef.isDestroyed()) {
    petWindowRef.webContents.send('pet:presence', current);
  }
}

export function getPresence(): PresenceState {
  return current;
}

export function initPresence(petWindow: BrowserWindow): void {
  petWindowRef = petWindow;
  current = 'active';
  if (timer) clearInterval(timer);
  // 不在这里立刻判定一次：启动时用户可能正好在看别的窗口，让第一轮 tick 自己去发现。
  timer = setInterval(tick, POLL_MS);
}

export function stopPresence(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
