import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// API Key 只用 Electron safeStorage 加密后存磁盘，绝不进 settings.json / 日志 / git。
//
// Windows 上 safeStorage 走的是 Chromium 的 OSCrypt（v10 格式）：文件里是"加密后的钥匙"，
// 而真正用来加密的密钥放在同一个 userData 目录的 `Local State` 里（由 Windows DPAPI 保护）。
// 所以换了 Windows 账户、重置过系统密码、或者换了个 userData 目录（比如直接用 electron 指向
// 某个 js 文件启动，应用名变成默认的 "Electron"），旧文件就解不开了。
//
// 之前"文件明明在、聊天却说没有 Key"的坑就在于：解不开时直接返回空字符串，
// 和"从没设置过"完全没法区分。现在把三种状态分开报，界面和报错信息都能说清楚。

export type ApiKeyState = 'missing' | 'ok' | 'unreadable';

export interface ApiKeyStatus {
  state: ApiKeyState;
  /** 只有 state === 'unreadable' 时有值，说明为什么读不出来 */
  reason: string | null;
}

function keyFilePath(): string {
  return path.join(app.getPath('userData'), 'apikey.enc');
}

/** 文件在不在（不代表能用）。 */
export function keyFileExists(): boolean {
  return fs.existsSync(keyFilePath());
}

export function apiKeyStatus(): ApiKeyStatus {
  if (!keyFileExists()) return { state: 'missing', reason: null };

  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return { state: 'unreadable', reason: '当前系统环境不支持解密（safeStorage 不可用）' };
    }
    const encrypted = fs.readFileSync(keyFilePath());
    const plain = safeStorage.decryptString(encrypted);
    if (!plain) return { state: 'unreadable', reason: '解密结果是空的' };
    return { state: 'ok', reason: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[whale-pet] 读取 API Key 失败:', message);
    return { state: 'unreadable', reason: message };
  }
}

/** 只有"真的能读出来"才算已设置——设置页提示和聊天前置检查都用这个。 */
export function hasApiKey(): boolean {
  return apiKeyStatus().state === 'ok';
}

export function saveApiKey(plainKey: string): void {
  const dir = path.dirname(keyFilePath());
  fs.mkdirSync(dir, { recursive: true });
  if (!plainKey) {
    // 空字符串当成"清除 key"
    try {
      fs.unlinkSync(keyFilePath());
    } catch {
      // 本来就没有文件，忽略
    }
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统不支持加密存储（safeStorage 不可用），无法保存 API Key');
  }
  const encrypted = safeStorage.encryptString(plainKey);
  fs.writeFileSync(keyFilePath(), encrypted);
}

/** 读不出来的统一返回空串（调用方要区分原因请用 apiKeyStatus）。 */
export function loadApiKey(): string {
  const status = apiKeyStatus();
  if (status.state !== 'ok') return '';
  try {
    return safeStorage.decryptString(fs.readFileSync(keyFilePath()));
  } catch {
    return '';
  }
}

/** 给人看的 Key 状态描述，设置页和报错信息共用。 */
export function describeApiKeyStatus(status: ApiKeyStatus): string {
  if (status.state === 'ok') return '已设置（留空保存 = 不修改；输入新的会覆盖旧的）';
  if (status.state === 'missing') return '还没设置，回复消息前必须先填一个';
  return `本机存着的 Key 读不出来了（${status.reason ?? '原因未知'}）。常见原因是换了 Windows 账户、重置过系统密码，或者换了应用数据目录；重新填一次就能修复。`;
}

export function apiKeyFilePath(): string {
  return keyFilePath();
}
