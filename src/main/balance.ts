import { BrowserWindow } from 'electron';
import { loadSettings } from './config';
import { loadApiKey, apiKeyStatus } from './secrets';
import type { BalanceView } from '../shared/types';

// DeepSeek 官方有个查余额的接口：GET {baseURL}/user/balance
// （见 https://api-docs.deepseek.com/zh-cn/api/get-user-balance/ ），返回
// { is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }。
//
// 查询频率：启动一次 + 每 6 小时一次 + 设置页/托盘菜单手动刷新。余额是慢变量，查太勤没意义，
// 而且这个接口有频率限制，被限流反而看不出真实余额。
// 换成别的 OpenAI 兼容服务（Ollama、中转站）时这个接口不存在，404 就记成"该服务不支持"，
// 不反复重试、也不当成错误弹给用户。

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

let petWindowRef: BrowserWindow | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const changeListeners: Array<() => void> = [];

/** 上一次"够用/不够用"的判断，保证"余额不足"只在从够变不够那一刻提醒一次，不反复念。 */
let lastReportedLow = false;

let snapshot: BalanceView = {
  ok: false,
  supported: true,
  currency: null,
  total: null,
  granted: null,
  toppedUp: null,
  fetchedAt: null,
  error: null,
  low: false,
};

export function getBalanceView(): BalanceView {
  return snapshot;
}

/** 余额快照更新后要重画的地方（托盘菜单）在这里注册，避免 balance 反向 import tray 造成循环依赖。 */
export function onBalanceChange(callback: () => void): void {
  changeListeners.push(callback);
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function currencySymbol(currency: string | null): string {
  return currency === 'USD' ? '$' : '¥';
}

interface QueryResult {
  supported?: boolean;
  currency?: string;
  total?: number;
  granted?: number | null;
  toppedUp?: number | null;
  error?: string;
}

/**
 * 解析 /user/balance 的响应体。单独抽出来是为了能脱离网络单独测（见 tests/balance.test.js）——
 * 这里最容易出错的是"0 元"和"字段缺失"的区别：余额真的为 0 时 total_balance 是字符串 "0"，
 * 必须当成"查到了，余额是 0"，不能当成没查到。
 */
export function parseBalancePayload(payload: unknown): QueryResult {
  const infos = (payload as { balance_infos?: unknown })?.balance_infos;
  const info = Array.isArray(infos) ? (infos[0] as Record<string, string> | undefined) : undefined;
  const total = toNumber(info?.total_balance);
  if (!info || total === null) {
    return { supported: false, error: '接口没有返回可用的余额信息' };
  }
  return {
    currency: info.currency ?? 'CNY',
    total,
    granted: toNumber(info.granted_balance),
    toppedUp: toNumber(info.topped_up_balance),
  };
}

async function queryBalance(): Promise<QueryResult> {
  // Key 的三种状态分开报：不然"文件在但解不开"和"从没设置过"在界面上长得一模一样。
  const keyStatus = apiKeyStatus();
  if (keyStatus.state === 'missing') return { error: '还没有设置 API Key' };
  if (keyStatus.state === 'unreadable') return { error: 'API Key 读不出来，请在设置里重填' };
  const apiKey = loadApiKey();
  if (!apiKey) return { error: 'API Key 读不出来，请在设置里重填' };

  // DeepSeek 的 OpenAI 兼容 base URL 常被填成 https://api.deepseek.com/v1，
  // 但查余额的路径是固定的 /user/balance（不带 /v1），这里顺手把结尾的 /v1 去掉。
  const baseURL = loadSettings()
    .baseURL.replace(/\/+$/, '')
    .replace(/\/v1$/, '');
  try {
    const response = await fetch(`${baseURL}/user/balance`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 404 || response.status === 405) {
      return { supported: false, error: '这个服务没有余额查询接口' };
    }
    if (response.status === 401 || response.status === 403) {
      return { error: 'API Key 无效或没有查余额的权限' };
    }
    if (!response.ok) {
      return { error: `查询失败：HTTP ${response.status}` };
    }

    return parseBalancePayload(await response.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // AbortSignal.timeout 抛的是 "The operation was aborted due to timeout"，
    // 网络不通则是 fetch 的 "fetch failed"，这两种分开说，用户才知道该查什么。
    if (/timeout/i.test(message)) return { error: '查询超时（网络或服务端没响应）' };
    return { error: `查询失败：${message.slice(0, 60)}` };
  }
}

/** 余额不足时给桌宠发一条提醒，让渲染进程切 balance-low 姿势 + 冒气泡。 */
function notifyPetIfLow(): void {
  const isLow = snapshot.ok && snapshot.low;
  if (isLow && !lastReportedLow && petWindowRef && !petWindowRef.isDestroyed()) {
    const amount = `${currencySymbol(snapshot.currency)}${(snapshot.total ?? 0).toFixed(2)}`;
    petWindowRef.webContents.send('pet:balance-low', {
      text: `余额只剩 ${amount} 了，记得充值哦，不然我就没法陪你聊天啦。`,
    });
  }
  // 只有"成功查到余额"时才更新这个标记：网络抖动导致的查询失败不该重新武装提醒。
  if (snapshot.ok) lastReportedLow = isLow;
}

/** 查一次余额并更新快照；不管成功失败都会通知监听者（托盘菜单要重画）。 */
export async function refreshBalance(): Promise<BalanceView> {
  const result = await queryBalance();
  const threshold = loadSettings().balanceWarnThreshold;

  if (typeof result.total === 'number') {
    snapshot = {
      ok: true,
      supported: true,
      currency: result.currency ?? 'CNY',
      total: result.total,
      granted: result.granted ?? null,
      toppedUp: result.toppedUp ?? null,
      fetchedAt: Date.now(),
      error: null,
      low: threshold > 0 && result.total < threshold,
    };
  } else {
    // 查不到时保留上一次查到的数字（界面上会同时显示"上次查到的是多少"和这次的失败原因），
    // 只把错误信息换掉。total 保持原值，避免界面突然显示成 0 让人以为钱花光了。
    snapshot = {
      ...snapshot,
      ok: false,
      supported: result.supported ?? snapshot.supported,
      error: result.error ?? '查询失败',
    };
  }

  notifyPetIfLow();
  for (const listener of changeListeners) listener();
  return snapshot;
}

export function initBalance(petWindow: BrowserWindow): void {
  petWindowRef = petWindow;
  if (timer) clearInterval(timer);
  void refreshBalance(); // 启动先查一次，用户在设置页里马上就能看到数字
  timer = setInterval(() => void refreshBalance(), REFRESH_INTERVAL_MS);
}

export function stopBalance(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
