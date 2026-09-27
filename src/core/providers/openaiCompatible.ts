import type { ChatMessage, ChatProvider, ChatProviderConfig, StreamHandlers } from './types';

/**
 * OpenAI 兼容格式的 provider：默认接 DeepSeek（https://api.deepseek.com），
 * 同一份实现改 baseURL 就能接 Ollama 等其他兼容 /chat/completions 的服务。
 */
export function createOpenAICompatibleProvider(config: ChatProviderConfig): ChatProvider {
  return {
    async streamChat(messages: ChatMessage[], handlers: StreamHandlers, signal: AbortSignal): Promise<void> {
      const base = config.baseURL.replace(/\/+$/, '');
      let res: Response;
      try {
        res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({ model: config.model, messages, stream: true }),
          signal,
        });
      } catch (err) {
        handlers.onError(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        handlers.onError(new Error(`API 请求失败（${res.status}）：${text.slice(0, 300)}`));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') continue;
            let delta: string | undefined;
            try {
              const json = JSON.parse(data);
              delta = json.choices?.[0]?.delta?.content;
            } catch {
              continue; // 单行解析失败不影响整体流，跳过就行
            }
            if (delta) {
              full += delta;
              handlers.onDelta(delta);
            }
          }
        }
      } catch (err) {
        handlers.onError(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      handlers.onDone(full);
    },
  };
}
