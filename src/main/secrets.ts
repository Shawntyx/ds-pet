import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// API Key 只用 Electron safeStorage 加密后存磁盘，绝不进 settings.json / 日志 / git。
function keyFilePath(): string {
  return path.join(app.getPath('userData'), 'apikey.enc');
}

export function hasApiKey(): boolean {
  return fs.existsSync(keyFilePath());
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

export function loadApiKey(): string {
  try {
    const encrypted = fs.readFileSync(keyFilePath());
    if (!safeStorage.isEncryptionAvailable()) return '';
    return safeStorage.decryptString(encrypted);
  } catch {
    return '';
  }
}
