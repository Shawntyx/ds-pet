import { BrowserWindow, powerMonitor } from 'electron';
import { loadSettings } from './config';
import { generateProactiveLine, pushAssistantLine } from './chatSession';
import { getActiveWindowInfo } from './activeWindow';
import { isTitleSensitive, parseFilterWords } from './privacyFilter';
import { pickHealthLine, pickPhilosophicalQuestion } from './proactiveLines';
import type { PetSettings } from '../shared/types';

const TICK_MS = 60_000; // 每分钟检查一次，够用了，不用卡得很准
const BREAK_IDLE_SEC = 5 * 60; // 系统空闲超过 5 分钟，就当用户歇过了，重新计"久坐"
const SITTING_THRESHOLD_MS = 60 * 60 * 1000; // SPEC 例子：连续使用 60 分钟

let petWindowRef: BrowserWindow | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let continuousActiveSince = Date.now();
let lastFireAt = Date.now(); // 启动时不要立刻就说话，先按正常间隔等一轮
let nextIntervalMs = 0;

function rollNextInterval(avgMinutes: number): number {
  // 平均值上下 40% 内随机，不然每次卡着整点说话会显得很机械。
  const base = Math.max(1, avgMinutes) * 60_000;
  const jitter = base * 0.4;
  return base - jitter + Math.random() * jitter * 2;
}

/** 把一句话送到桌宠那边：复用阶段 2 已有的"回复完播情绪表情 + 冒气泡"那条路径，
 * 主动说话和真的聊天回复在桌宠身上看起来是一样的，用户分不出也不需要分。 */
function speak(text: string, emotion: string | null): void {
  if (!petWindowRef || petWindowRef.isDestroyed()) return;
  petWindowRef.webContents.send('pet:reply', { text, emotion });
}

async function fireHealth(): Promise<void> {
  const hour = new Date().getHours();
  const isLateNight = hour >= 0 && hour < 6;
  const sittingTooLong = Date.now() - continuousActiveSince >= SITTING_THRESHOLD_MS;

  const kind: 'sitting' | 'water' | 'lateNight' = isLateNight
    ? 'lateNight'
    : sittingTooLong && Math.random() < 0.6
      ? 'sitting'
      : 'water';

  const line = pickHealthLine(kind);
  pushAssistantLine(line.text);
  speak(line.text, line.emotion);
}

async function fireWindowRoast(settings: PetSettings): Promise<void> {
  const info = await getActiveWindowInfo();
  if (!info || !info.title) return;
  const userWords = parseFilterWords(settings.proactive.titleFilterWords);
  if (isTitleSensitive(info.title, userWords)) return;

  const instruction =
    `（系统提示，不是用户说的话）用户现在正在用的窗口是："${info.processName} - ${info.title}"。` +
    '请用你的人设语气，针对这个窗口内容简短吐槽或者鼓励一句，口语化，不超过 30 字，' +
    '记得按格式在开头带一个情绪标签。';
  const result = await generateProactiveLine(instruction);
  if (result) speak(result.text, result.emotion);
}

async function fireQuestion(): Promise<void> {
  const question = pickPhilosophicalQuestion();
  pushAssistantLine(question);
  speak(question, null);
}

async function fireOne(settings: PetSettings): Promise<void> {
  const candidates: Array<() => Promise<void>> = [];
  if (settings.proactive.healthReminder) candidates.push(fireHealth);
  if (settings.proactive.windowTitleRoast) candidates.push(() => fireWindowRoast(settings));
  if (settings.proactive.randomQuestion) candidates.push(fireQuestion);
  if (candidates.length === 0) return;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  await pick();
}

function tick(): void {
  const settings = loadSettings();

  // 空闲太久（比如离开电脑去吃饭）就当歇过了，重新计久坐时间；不管勿扰/开关状态都要算，
  // 这样用户回来之后的判断才准，不会因为离开了一下就被当成"一直坐着"。
  const idleSec = powerMonitor.getSystemIdleTime();
  if (idleSec >= BREAK_IDLE_SEC) {
    continuousActiveSince = Date.now();
  }

  if (settings.doNotDisturb || !settings.proactive.enabled) return;

  if (nextIntervalMs === 0) nextIntervalMs = rollNextInterval(settings.proactive.avgIntervalMinutes);
  if (Date.now() - lastFireAt < nextIntervalMs) return;

  lastFireAt = Date.now();
  nextIntervalMs = rollNextInterval(settings.proactive.avgIntervalMinutes);
  void fireOne(settings);
}

export function initProactive(petWindow: BrowserWindow): void {
  petWindowRef = petWindow;
  continuousActiveSince = Date.now();
  lastFireAt = Date.now();
  nextIntervalMs = 0;
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(tick, TICK_MS);
}

export function stopProactive(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}
