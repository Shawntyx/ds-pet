import { createOpenAICompatibleProvider } from '../core/providers/openaiCompatible';
import type { ChatMessage } from '../core/providers/types';
import { loadSettings } from './config';
import { readPersonaContent } from './persona';
import { loadApiKey } from './secrets';
import {
  appendMessage,
  clearMessages,
  dropLastMessage,
  getMessages,
  recentRounds,
} from './chatStore';
import { memorySection, noteCompletedExchange } from './memory';

export const EMOTION_TAGS = ['happy', 'shy', 'sad', 'angry', 'surprised', 'love'] as const;
export type Emotion = (typeof EMOTION_TAGS)[number];

const TAG_PATTERN = new RegExp(`^\\s*\\[(${EMOTION_TAGS.join('|')})\\]\\s*`, 'i');

/** 会话历史从阶段 4 起落在 userData/chat/history.json 里（见 chatStore.ts），重启能接着聊。 */
export function getHistory(): ChatMessage[] {
  return getMessages();
}

export function clearHistory(): void {
  clearMessages();
}

/** 主动说话里不调模型的固定台词（健康提醒/哲学问题）也记进历史，
 * 这样用户在气泡下面的输入框回一句时，模型能看到自己刚才说了什么。 */
export function pushAssistantLine(text: string): void {
  if (!text) return;
  appendMessage({ role: 'assistant', content: text });
}

function buildSystemPrompt(): string {
  const settings = loadSettings();
  const persona = readPersonaContent(settings.activePersona) || '你是一个友善的桌面宠物助手。';
  // 长期记忆直接贴在 system prompt 后面（阶段 4）：没有可用记忆时 memorySection() 是空串。
  const memory = memorySection();
  return memory ? `${persona}\n\n${memory}` : persona;
}

/** 发给模型的上下文：人设 + 最近 N 轮（N 在设置里，避免上下文过长，SPEC §5.4）。 */
function buildContextMessages(): ChatMessage[] {
  const settings = loadSettings();
  return [
    { role: 'system', content: buildSystemPrompt() },
    ...recentRounds(getMessages(), settings.chatHistoryRounds),
  ];
}

/** 从回复开头摘出情绪标签，返回去掉标签后的正文和识别到的情绪（没有就是 null）。 */
export function extractEmotion(text: string): { text: string; emotion: Emotion | null } {
  const match = text.match(TAG_PATTERN);
  if (!match) return { text: text.trim(), emotion: null };
  return { text: text.slice(match[0].length).trim(), emotion: match[1].toLowerCase() as Emotion };
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
    const stillMaybeOpeningTag = /^\s*\[[a-zA-Z]*$/.test(buffer) && !buffer.includes(']');
    if (stillMaybeOpeningTag && buffer.length < TAG_SNIFF_LIMIT) {
      return; // 还判断不出来，继续攒
    }
    resolved = true;
    const match = buffer.match(TAG_PATTERN);
    const rest = match ? buffer.slice(match[0].length) : buffer;
    if (rest) onClean(rest);
  };
}

export interface SendHandlers {
  onThinkingStart: () => void;
  onDelta: (delta: string) => void;
  onDone: (payload: { text: string; emotion: Emotion | null }) => void;
  onError: (message: string) => void;
}

export async function sendUserMessage(userText: string, handlers: SendHandlers): Promise<void> {
  const apiKey = loadApiKey();
  if (!apiKey) {
    handlers.onError('还没有设置 API Key，去设置里填一下吧。');
    return;
  }
  const settings = loadSettings();
  const provider = createOpenAICompatibleProvider({
    apiKey,
    baseURL: settings.baseURL,
    model: settings.model,
  });

  appendMessage({ role: 'user', content: userText });
  const messages: ChatMessage[] = buildContextMessages();

  handlers.onThinkingStart();
  const controller = new AbortController();

  await provider.streamChat(
    messages,
    {
      onDelta: (delta) => handlers.onDelta(delta),
      onDone: (fullText) => {
        const { text, emotion } = extractEmotion(fullText);
        appendMessage({ role: 'assistant', content: text });
        handlers.onDone({ text, emotion });
        // 一轮完整对话结束：攒够设置里的轮数就后台提取长期记忆（不阻塞回复显示）。
        void noteCompletedExchange();
      },
      onError: (error) => {
        // 请求失败就把这轮用户消息也撤回，避免历史里有"提问但没有回答"的断层。
        dropLastMessage();
        handlers.onError(error.message);
      },
    },
    controller.signal
  );
}

/**
 * 阶段 3 窗口标题吐槽用：不走正常的"用户发了一句话"流程（不往历史里塞假的用户发言），
 * 只拿 instruction 当这次请求单独的提示语，让模型基于当前上下文说一句主动搭话的话。
 * 失败/没配 Key 就返回 null，调用方该跳过就跳过，不是什么严重错误。
 */
export async function generateProactiveLine(
  instruction: string
): Promise<{ text: string; emotion: Emotion | null } | null> {
  const apiKey = loadApiKey();
  if (!apiKey) return null;
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
            if (!text) {
              resolve(null);
              return;
            }
            appendMessage({ role: 'assistant', content: text });
            resolve({ text, emotion });
          },
          onError: () => resolve(null),
        },
        controller.signal
      )
      .catch(() => resolve(null));
  });
}
