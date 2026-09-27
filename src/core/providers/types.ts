// ChatProvider 是聊天模型接入的统一接口，第一版只有 OpenAI 兼容实现（接 DeepSeek），
// Anthropic 的位置先占好（见 anthropic.ts），第二版工具调用（function calling）也从这里扩展。

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

export interface ChatProviderConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

export interface ChatProvider {
  /** 流式发一轮对话；handlers.onDone 之前可能已经调用过多次 onDelta。 */
  streamChat(messages: ChatMessage[], handlers: StreamHandlers, signal: AbortSignal): Promise<void>;
}
