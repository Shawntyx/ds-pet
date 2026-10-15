import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { ChatMessage } from '../core/providers/types';

// 聊天记录持久化（SPEC §5.4 上半部分）：重启之后能接着聊，发给模型时只带最近若干轮。
//
// 存一个 JSON 文件（userData/chat/history.json）而不是 SQLite：现在只需要"顺序读回来 + 追加 +
// 截断"，JSON 完全够用，也省掉 better-sqlite3 那种原生模块在打包和 Node ABI 上的麻烦。
//
// 【对话（conversation）】阶段 5 起引入：每条消息带一个对话编号，模型只看到**当前这段对话**，
// 更早的对话留在文件里给用户翻看。这样"她在气泡里主动说了一句 → 你回她"就是一段干净的新对话，
// 不会和之前聊的内容搅在一起（人设和长期记忆照旧注入，所以她依然记得你）。
//
// 有两层截断，别搞混：
//   1) 文件里最多留 MAX_STORED_MESSAGES 条（capMessages）——防止无限膨胀；
//   2) 发给模型时只带当前对话里最近 chatHistoryRounds 轮（recentRounds）——防止上下文过长。

/** 文件里最多留多少条消息（约 200 轮），超了从最旧的丢。 */
export const MAX_STORED_MESSAGES = 400;
/** 每次追加都写盘太浪费，攒一小会儿再写。 */
const SAVE_DEBOUNCE_MS = 800;

/** 存下来的消息：在 ChatMessage 上多一个"属于哪段对话"。 */
export interface StoredMessage extends ChatMessage {
  conversation: number;
}

interface StoredFile {
  version: 1 | 2;
  messages: StoredMessage[];
  /** 当前对话编号（老文件里没有这个字段，读的时候按最大的对话号补） */
  currentConversation?: number;
}

let messages: StoredMessage[] = [];
let currentConversation = 1;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

export function historyFilePath(): string {
  return path.join(app.getPath('userData'), 'chat', 'history.json');
}

/** 去掉开头孤零零的 assistant 消息：那多半是被截断掉提问的回复，
 * 模型看到"自己说过一句话"却没有上下文会犯迷糊。 */
function trimLeadingAssistant<T extends ChatMessage>(list: T[]): T[] {
  let start = 0;
  while (start < list.length && list[start].role !== 'user') start++;
  return start === 0 ? list : list.slice(start);
}

/** 只留最后 limit 条（纯函数，方便测）。 */
export function capMessages<T extends ChatMessage>(list: T[], limit: number): T[] {
  if (list.length <= limit) return trimLeadingAssistant(list);
  return trimLeadingAssistant(list.slice(list.length - limit));
}

/**
 * 取"最近 maxRounds 轮"。一轮 = 一条用户消息 + 它的回复，
 * 所以从末尾往前数到第 maxRounds + 1 条用户消息为止（纯函数，方便测）。
 */
export function recentRounds<T extends ChatMessage>(list: T[], maxRounds: number): T[] {
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

/**
 * 去掉末尾"没有回答的提问"（纯函数，方便测）。
 * 正常流程下请求失败会主动撤回、用户停止也会撤回，所以只有进程被杀这种情况会留下它。
 */
export function pruneIncompleteTail<T extends ChatMessage>(list: T[]): T[] {
  const out = [...list];
  while (out.length > 0 && out[out.length - 1].role === 'user') out.pop();
  return out;
}

/** 启动时调一次（要在 app ready 之后，因为要拿 userData 路径）。 */
export function initChatStore(): void {
  initialized = true;
  const loaded = readStoredMessages();
  const pruned = pruneIncompleteTail(loaded);
  messages = pruned;
  currentConversation =
    messages.reduce((max, message) => Math.max(max, message.conversation), 1) || 1;
  if (pruned.length !== loaded.length) {
    // 上次是崩溃/强退的：末尾那条提问没有回答，留着会让面板显示一条永远等不到回复的消息，
    // 也会被当成上下文发给模型。直接清掉。
    console.log(`[whale-pet] 清掉了 ${loaded.length - pruned.length} 条没有回答的提问`);
    scheduleSave();
  }
}

/** 面板用：全部消息（含对话编号，用来画"新的对话"分隔线）。 */
export function getStoredMessages(): StoredMessage[] {
  return messages;
}

/** 发给模型用：只有当前这段对话。 */
export function getConversationMessages(): ChatMessage[] {
  return messages
    .filter((message) => message.conversation === currentConversation)
    .map(({ role, content }) => ({ role, content }));
}

export function currentConversationId(): number {
  return currentConversation;
}

/** 开一段新对话（气泡里回复她的主动说话、或者用户点"新对话"）。返回新的对话编号。 */
export function startNewConversation(): number {
  currentConversation += 1;
  scheduleSave();
  return currentConversation;
}

export function messageCount(): number {
  return messages.length;
}

export function appendMessage(message: ChatMessage): void {
  messages.push({ ...message, conversation: currentConversation });
  enforceStorageCap();
  scheduleSave();
}

/** 请求失败/用户停止时把刚追加的用户消息撤回，避免历史里留下"提问没有回答"的断层。 */
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

/** 超出上限就从最旧的丢（原地改，不换数组引用——外面可能正拿着 getStoredMessages() 的返回值）。 */
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
    const payload: StoredFile = { version: 2, messages, currentConversation };
    // 先写临时文件再改名：写到一半崩了也不会把原来的记录毁掉。
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf-8');
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('[whale-pet] 聊天记录写入失败:', err);
  }
}

function readStoredMessages(): StoredMessage[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(historyFilePath(), 'utf-8')) as Partial<StoredFile>;
    const list = Array.isArray(parsed.messages) ? parsed.messages : [];
    // 只收 user/assistant：system 是我们每轮现拼的人设，不应该从文件里读回来。
    // 老文件（version 1）没有 conversation 字段，一律算第 1 段对话。
    return list
      .filter(
        (message): message is StoredMessage =>
          !!message &&
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string' &&
          message.content.length > 0
      )
      .map((message) => ({
        role: message.role,
        content: message.content,
        conversation:
          typeof message.conversation === 'number' && message.conversation > 0
            ? message.conversation
            : 1,
      }));
  } catch {
    // 文件不存在或损坏：从空记录开始，不当成致命错误。
    return [];
  }
}
