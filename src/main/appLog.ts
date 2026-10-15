import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// 打包版是 GUI 子系统进程：它没有终端，stdout 抓不到（实测 Start-Process 重定向也是空文件）。
// 所以出问题时"看不见任何东西"——用户只能说"没反应"，我这边无从下手。
// 这里把关键日志同时写进文件：%APPDATA%\whale-pet\logs\app.log（只保留最后一段，不会无限长大）。
//
// 记的东西刻意精简，够排查就行：
//   - 启动信息（版本、是否打包、数据目录、素材目录）
//   - 主进程的未捕获异常
//   - 渲染进程的报错（preload 里挂钩子，统一报过来）

const MAX_LOG_BYTES = 200 * 1024;
let logFile: string | null = null;

function resolveLogFile(): string | null {
  if (logFile) return logFile;
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logFile = path.join(dir, 'app.log');
    return logFile;
  } catch {
    return null;
  }
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** 写一行日志。任何写失败都吞掉——日志不该反过来把应用搞崩。 */
export function logLine(message: string): void {
  const line = `[${stamp()}] ${message}\n`;
  try {
    const file = resolveLogFile();
    if (!file) return;
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) {
      // 超了就留最后 100KB，避免日志无限增长
      const content = fs.readFileSync(file, 'utf-8');
      fs.writeFileSync(file, content.slice(-100 * 1024), 'utf-8');
    }
    fs.appendFileSync(file, line, 'utf-8');
  } catch {
    /* 忽略 */
  }
}

export function logFilePath(): string | null {
  return resolveLogFile();
}

/**
 * 装日志钩子。要在 app ready 前后都能用，所以不依赖窗口存在。
 * 渲染进程的报错通过 ipcMain 的 'app:renderer-error' 通道送过来（见 preload.ts）。
 */
export function setupLogging(): void {
  process.on('uncaughtException', (error) => {
    logLine(`主进程未捕获异常: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  });
  process.on('unhandledRejection', (reason) => {
    logLine(`主进程未处理的 Promise 拒绝: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
  });

  ipcMain.on('app:renderer-error', (_event, payload: { source?: string; message?: string; stack?: string }) => {
    const where = payload?.source ? ` [${payload.source}]` : '';
    logLine(`渲染进程报错${where}: ${payload?.message ?? '(无消息)'}${payload?.stack ? `\n${payload.stack}` : ''}`);
  });
  ipcMain.on('app:renderer-log', (_event, payload: { source?: string; message?: string }) => {
    logLine(`渲染进程日志${payload?.source ? ` [${payload.source}]` : ''}: ${payload?.message ?? ''}`);
  });
}
