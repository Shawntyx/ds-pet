import { createOpenAICompatibleProvider } from '../core/providers/openaiCompatible';
import type { ChatMessage } from '../core/providers/types';
import { loadSettings } from './config';
import { readPersonaContent } from './persona';
import { apiKeyStatus, loadApiKey } from './secrets';
import {
  appendMessage,
  clearMessages,
  dropLastMessage,
  getConversationMessages,
  getStoredMessages,
  recentRounds,
  startNewConversation,
  type StoredMessage,
} from './chatStore';
import { memorySection, noteCompletedExchange } from './memory';

export const EMOTION_TAGS = ['happy', 'shy', 'sad', 'angry', 'surprised', 'love'] as const;
export type Emotion = (typeof EMOTION_TAGS)[number];

/**
 * 回复开头的"标签形状"：方括号里 1~16 个不含空格和 ] 的字符，且至少含一个字母或汉字。
 *
 * 为什么要认"所有"标签而不是只认已知的 6 个：模型偶尔会自己造标签（实测有过 `[hmm]`），
 * 只认已知标签的话这种就会原样漏给用户看，变成 "[hmm] 道德哲学啊…" 这种噪音。
 * 反过来，`[1]` 这种纯数字（有人爱用方括号列清单）不算标签，不会被吃掉。
 */
const TAG_SHAPE = /^\s*\[([^\]\s]{1,16})\]\s*/;

/** 判断开头的标签并返回它的长度；不是标签形状就返回 null。 */
function tagAtStart(text: string): { tag: string; length: number } | null {
  const match = text.match(TAG_SHAPE);
  if (!match) return null;
  if (!/[A-Za-z\u4e00-\u9fff]/.test(match[1])) return null;
  return { tag: match[1].toLowerCase(), length: match[0].length };
}

/** 面板要看的全部历史（带对话编号，用来画"新的对话"分隔线）。 */
export function getHistory(): StoredMessage[] {
  return getStoredMessages();
}

export function clearHistory(): void {
  clearMessages();
}

function buildSystemPrompt(): string {
  const settings = loadSettings();
  const persona = readPersonaContent(settings.activePersona) || '你是一个友善的桌面宠物助手。';
  // 长期记忆直接贴在 system prompt 后面（阶段 4）：没有可用记忆时 memorySection() 是空串。
  const memory = memorySection();
  return memory ? `${persona}\n\n${memory}` : persona;
}

/** 发给模型的上下文：人设 + 长期记忆 + **当前这段对话**最近的 N 轮。
 *  （更早的对话留在文件里给用户翻，不进上下文；人设和记忆照旧，所以她还是记得你。） */
function buildContextMessages(): ChatMessage[] {
  const settings = loadSettings();
  return [
    { role: 'system', content: buildSystemPrompt() },
    ...recentRounds(getConversationMessages(), settings.chatHistoryRounds),
  ];
}

/**
 * 从回复开头摘出情绪标签，返回去掉标签后的正文和识别到的情绪（不认识的标签只去掉、不当情绪）。
 */
export function extractEmotion(text: string): { text: string; emotion: Emotion | null } {
  const found = tagAtStart(text);
  if (!found) return { text: text.trim(), emotion: null };
  const emotion = (EMOTION_TAGS as readonly string[]).includes(found.tag)
    ? (found.tag as Emotion)
    : null;
  return { text: text.slice(found.length).trim(), emotion };
}

/**
 * persona.md 要求模型把情绪标签放在回复最开头、且不能让用户看到。标签是一路流式吐出来的，
 * 不能只在最后才去掉——这里在真正转发给某个窗口之前，先攒住开头这一小段，判断出
 * "确实是/确定不是"标签之后再决定要不要把标签部分吃掉。聊天面板、气泡小窗口共用这一份。
 */
const TAG_SNIFF_LIMIT = 20; // 攒够这么多字符还判断不出来就放弃等待，原样吐出去，防止异常输出卡住不出字
export function createTagStrippingRelay(onClean: (text: string) => void): (raw: string) => void {
  let buffer = '';
  let resolved = false;
  return (raw: string) => {
    if (resolved) {
      onClean(raw);
      return;
    }
    buffer += raw;
    const stillMaybeOpeningTag = /^\s*\[[^\]\s]*$/.test(buffer) && buffer.length < TAG_SNIFF_LIMIT;
    if (stillMaybeOpeningTag) {
      return; // 还判断不出来，继续攒
    }
    resolved = true;
    const found = tagAtStart(buffer);
    const rest = found ? buffer.slice(found.length) : buffer;
    if (rest) onClean(rest);
  };
}

export interface SendHandlers {
  onThinkingStart: () => void;
  onDelta: (delta: string) => void;
  onDone: (payload: { text: string; emotion: Emotion | null }) => void;
  /**
   * 用户按了停止（也可能是一句话都没收到就停了，这时 payload 是 null）。
   * 和 onError 分开：停止是用户主动行为，界面不该报错，历史也不该被当成失败撤回。
   */
  onStopped: (payload: { text: string; emotion: Emotion | null } | null) => void;
  onError: (message: string) => void;
}

/**
 * 同一时刻只允许一轮用户发起的请求在飞。
 *
 * 面板和气泡是两个窗口，都能发消息；没有这把锁的话两边可以同时发，历史里两条提问交错，
 * 记忆提取也可能拿到半截对话。锁住之后第二个发送者会收到一句客气的提示。
 */
let inflight: { controller: AbortController; cancelled: boolean; received: string } | null = null;

export function isChatBusy(): boolean {
  return inflight !== null;
}

/** 用户按"停止"：中断当前请求。返回 false 表示本来就没有请求在跑。 */
export function cancelCurrentRequest(): boolean {
  if (!inflight) return false;
  inflight.cancelled = true;
  inflight.controller.abort();
  return true;
}

function resolveApiKey(): { apiKey: string } | { error: string } {
  const status = apiKeyStatus();
  if (status.state === 'missing') {
    return { error: '还没有设置 API Key，去设置里填一下吧。' };
  }
  if (status.state === 'unreadable') {
    return {
      error: `本机保存的 API Key 读不出来了（${status.reason ?? '原因未知'}），请在设置里重新填一次。`,
    };
  }
  const apiKey = loadApiKey();
  if (!apiKey) return { error: 'API Key 是空的，请在设置里重新填一次。' };
  return { apiKey };
}

export interface SendOptions {
  /**
   * 开一段新对话再发这句（用户在气泡里回复她的主动说话时用）。
   * seedText 是"她刚才主动说的那句话"，会作为新对话的开头记下来——
   * 这样这段对话单独看是完整的，而它又不会混进之前那段聊天里。
   */
  newConversation?: { seedText?: string };
}

export async function sendUserMessage(
  userText: string,
  handlers: SendHandlers,
  options?: SendOptions
): Promise<void> {
  if (inflight) {
    handlers.onError('她还在回上一句，稍等一下再发嘛～');
    return;
  }
  const resolved = resolveApiKey();
  if ('error' in resolved) {
    handlers.onError(resolved.error);
    return;
  }
  const apiKey = resolved.apiKey;

  const settings = loadSettings();
  const provider = createOpenAICompatibleProvider({
    apiKey,
    baseURL: settings.baseURL,
    model: settings.model,
  });

  const entry = { controller: new AbortController(), cancelled: false, received: '' };
  inflight = entry;

  if (options?.newConversation) {
    startNewConversation();
    const seed = options.newConversation.seedText?.trim();
    if (seed) appendMessage({ role: 'assistant', content: seed });
  }
  appendMessage({ role: 'user', content: userText });
  const messages: ChatMessage[] = buildContextMessages();

  handlers.onThinkingStart();

  try {
    await provider.streamChat(
      messages,
      {
        onDelta: (delta) => {
          entry.received += delta;
          handlers.onDelta(delta);
        },
        onDone: (fullText) => {
          const { text, emotion } = extractEmotion(fullText);
          appendMessage({ role: 'assistant', content: text });
          handlers.onDone({ text, emotion });
        },
        onError: (error) => {
          if (entry.cancelled) {
            // 用户主动停止：已经吐出来的部分留下来当这一轮的回复（还能接着聊），
            // 一个字都没收到就把提问也撤回，不留"提问没有回答"的断层。
            const { text, emotion } = extractEmotion(entry.received);
            if (text) {
              appendMessage({ role: 'assistant', content: text });
              handlers.onStopped({ text, emotion });
            } else {
              dropLastMessage();
              handlers.onStopped(null);
            }
            return;
          }
          // 真的失败了才撤回提问。
          dropLastMessage();
          handlers.onError(error.message);
        },
      },
      entry.controller.signal
    );
  } finally {
    if (inflight === entry) inflight = null;
  }
}

/**
 * 阶段 3 窗口标题吐槽用：不走正常的"用户发了一句话"流程，只拿 instruction 当这次请求
 * 单独的提示语，让模型基于当前上下文说一句主动搭话的话。
 *
 * 注意：主动说话**不进聊天记录**（用户明确要求）——它只是一次性生成 + 冒个气泡。
 * 用户在气泡里回她时，那句话会作为"新对话的开头"由 bubbleWindow 传进来。
 * 失败/没配 Key 就返回 null，调用方该跳过就跳过，不是什么严重错误。
 */
export async function generateProactiveLine(
  instruction: string
): Promise<{ text: string; emotion: Emotion | null } | null> {
  // 用户正在聊天就别插嘴了（也别跟用户的消息抢历史顺序）。
  if (inflight) return null;
  const resolved = resolveApiKey();
  if ('error' in resolved) return null;
  const apiKey = resolved.apiKey;

  const settings = loadSettings();
  const provider = createOpenAICompatibleProvider({
    apiKey,
    baseURL: settings.baseURL,
    model: settings.model,
  });

  const messages: ChatMessage[] = [
    ...buildContextMessages(),
    { role: 'user', content: instruction },
  ];

  return new Promise((resolve) => {
    const controller = new AbortController();
    provider
      .streamChat(
        messages,
        {
          onDelta: () => {},
          onDone: (fullText) => {
            const { text, emotion } = extractEmotion(fullText);
            resolve(text ? { text, emotion } : null);
          },
          onError: () => resolve(null),
        },
        controller.signal
      )
      .catch(() => resolve(null));
  });
}
