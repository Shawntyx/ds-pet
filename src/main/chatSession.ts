import { createOpenAICompatibleProvider } from '../core/providers/openaiCompatible';
import type { ChatMessage } from '../core/providers/types';
import { loadSettings } from './config';
import { readPersonaContent } from './persona';
import { loadApiKey } from './secrets';

export const EMOTION_TAGS = ['happy', 'shy', 'sad', 'angry', 'surprised', 'love'] as const;
export type Emotion = (typeof EMOTION_TAGS)[number];

const TAG_PATTERN = new RegExp(`^\\s*\\[(${EMOTION_TAGS.join('|')})\\]\\s*`, 'i');

/** 会话历史只存内存，进程重启就没了——聊天记录持久化是阶段 4 的事。 */
let history: ChatMessage[] = [];

export function getHistory(): ChatMessage[] {
  return history;
}

export function clearHistory(): void {
  history = [];
}

function buildSystemPrompt(): string {
  const settings = loadSettings();
  const persona = readPersonaContent(settings.activePersona);
  return persona || '你是一个友善的桌面宠物助手。';
}

/** 从回复开头摘出情绪标签，返回去掉标签后的正文和识别到的情绪（没有就是 null）。 */
export function extractEmotion(text: string): { text: string; emotion: Emotion | null } {
  const match = text.match(TAG_PATTERN);
  if (!match) return { text: text.trim(), emotion: null };
  return { text: text.slice(match[0].length).trim(), emotion: match[1].toLowerCase() as Emotion };
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

  history.push({ role: 'user', content: userText });
  const messages: ChatMessage[] = [{ role: 'system', content: buildSystemPrompt() }, ...history];

  handlers.onThinkingStart();
  const controller = new AbortController();

  await provider.streamChat(
    messages,
    {
      onDelta: (delta) => handlers.onDelta(delta),
      onDone: (fullText) => {
        const { text, emotion } = extractEmotion(fullText);
        history.push({ role: 'assistant', content: text });
        handlers.onDone({ text, emotion });
      },
      onError: (error) => {
        // 请求失败就把这轮用户消息也撤回，避免历史里有"提问但没有回答"的断层。
        history.pop();
        handlers.onError(error.message);
      },
    },
    controller.signal
  );
}
