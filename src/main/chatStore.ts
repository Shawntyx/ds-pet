import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { ChatMessage } from '../core/providers/types';

// 聊天记录持久化（SPEC §5.4 上半部分）：重启之后能接着聊，发给模型时只带最近若干轮。
//
// 存一个 JSON 文件（userData/chat/history.json）而不是 SQLite：现在只需要"顺序读回来 + 追加 +
// 截断"，JSON 完全够用，也省掉 better-sqlite3 那种原生模块在打包和 Node ABI 上的麻烦。
// 以后真要做全文检索再换后端，这里的 append/recent/clear 接口不用动。
//
// 有两层截断，别搞混：
//   1) 文件里最多留 MAX_STORED_MESSAGES 条（capMessages）——防止无限膨胀；
//   2) 发给模型时只带最近 chatHistoryRounds 轮（recentRounds）——防止上下文过长。

/** 文件里最多留多少条消息（约 200 轮），超了从最旧的丢。 */
export const MAX_STORED_MESSAGES = 400;
/** 每次追加都写盘太浪费，攒一小会儿再写。 */
const SAVE_DEBOUNCE_MS = 800;

interface StoredFile {
  version: 1;
  messages: ChatMessage[];
}

let messages: ChatMessage[] = [];
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

export function historyFilePath(): string {
  return path.join(app.getPath('userData'), 'chat', 'history.json');
}

/** 去掉开头孤零零的 assistant 消息：那多半是被截断掉提问的回复，
 * 模型看到"自己说过一句话"却没有上下文会犯迷糊。 */
function trimLeadingAssistant(list: ChatMessage[]): ChatMessage[] {
  let start = 0;
  while (start < list.length && list[start].role !== 'user') start++;
  return start === 0 ? list : list.slice(start);
}

/** 只留最后 limit 条（纯函数，方便测）。 */
export function capMessages(list: ChatMessage[], limit: number): ChatMessage[] {
  if (list.length <= limit) return trimLeadingAssistant(list);
  return trimLeadingAssistant(list.slice(list.length - limit));
}

/**
 * 取"最近 maxRounds 轮"发给模型。一轮 = 一条用户消息 + 它的回复，
 * 所以从末尾往前数到第 maxRounds + 1 条用户消息为止（纯函数，方便测）。
 */
export function recentRounds(list: ChatMessage[], maxRounds: number): ChatMessage[] {
  const rounds = Math.max(1, Math.floor(maxRounds) || 1);
  let seen = 0;
  let start = list.length;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].role === 'user') {
      seen++;
      if (seen > rounds) break;
    }
    start = i;
  }
  return trimLeadingAssistant(list.slice(start));
}

/** 启动时调一次（要在 app ready 之后，因为要拿 userData 路径）。 */
export function initChatStore(): void {
  initialized = true;
  const loaded = readStoredMessages();
  const pruned = pruneIncompleteTail(loaded);
  messages = pruned;
  if (pruned.length !== loaded.length) {
    // 上次是崩溃/强退的：末尾那条提问没有回答，留着会让面板显示一条永远等不到回复的消息，
    // 也会被当成上下文发给模型。直接清掉。
    console.log(`[whale-pet] 清掉了 ${loaded.length - pruned.length} 条没有回答的提问`);
    scheduleSave();
  }
}

/**
 * 去掉末尾"没有回答的提问"（纯函数，方便测）。
 * 正常流程下请求失败会主动撤回、用户停止也会撤回，所以只有进程被杀这种情况会留下它。
 */
export function pruneIncompleteTail(list: ChatMessage[]): ChatMessage[] {
  const out = [...list];
  while (out.length > 0 && out[out.length - 1].role === 'user') out.pop();
  return out;
}

export function getMessages(): ChatMessage[] {
  return messages;
}

export function messageCount(): number {
  return messages.length;
}

export function appendMessage(message: ChatMessage): void {
  messages.push(message);
  enforceStorageCap();
  scheduleSave();
}

/** 请求失败时把刚追加的用户消息撤回，避免历史里留下"提问没有回答"的断层。 */
export function dropLastMessage(): void {
  messages.pop();
  scheduleSave();
}

export function clearMessages(): number {
  const removed = messages.length;
  messages.length = 0;
  scheduleSave();
  return removed;
}

/** 超出上限就从最旧的丢（原地改，不换数组引用——外面可能正拿着 getMessages() 的返回值）。 */
function enforceStorageCap(): void {
  if (messages.length <= MAX_STORED_MESSAGES) return;
  const capped = capMessages(messages, MAX_STORED_MESSAGES);
  messages.splice(0, messages.length, ...capped);
}

function scheduleSave(): void {
  if (!initialized) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
}

/** 立刻落盘（退出前调，别丢最后几条）。 */
export function flushChatStore(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveNow();
}

function saveNow(): void {
  saveTimer = null;
  try {
    const file = historyFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const payload: StoredFile = { version: 1, messages };
    // 先写临时文件再改名：写到一半崩了也不会把原来的记录毁掉。
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf-8');
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('[whale-pet] 聊天记录写入失败:', err);
  }
}

function readStoredMessages(): ChatMessage[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(historyFilePath(), 'utf-8')) as Partial<StoredFile>;
    const list = Array.isArray(parsed.messages) ? parsed.messages : [];
    // 只收 user/assistant：system 是我们每轮现拼的人设，不应该从文件里读回来。
    return list
      .filter(
        (m): m is ChatMessage =>
          !!m &&
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string' &&
          m.content.length > 0
      )
      .map((m) => ({ role: m.role, content: m.content }));
  } catch {
    // 文件不存在或损坏：从空记录开始，不当成致命错误。
    return [];
  }
}
