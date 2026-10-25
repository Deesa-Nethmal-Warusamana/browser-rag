import type { ChatMessage } from '../lib/types';

export interface ApiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

async function describeFailure(response: Response): Promise<string> {
  let detail = '';
  try {
    const body = await response.text();
    detail = body.slice(0, 400);
  } catch {
    /* ignore */
  }
  return `API request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ''}`;
}

/**
 * Stream a chat completion from any OpenAI-compatible endpoint.
 * Parses server-sent events manually so no SDK is needed.
 */
export async function* streamCompletion(
  messages: ChatMessage[],
  config: ApiConfig,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      temperature: 0.2,
      max_tokens: 800,
    }),
    signal,
  });

  if (!response.ok) throw new Error(await describeFailure(response));
  if (!response.body) throw new Error('API returned an empty response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          /* keep-alive or partial frame — ignore */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
