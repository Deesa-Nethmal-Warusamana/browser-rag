import type { ChatMessage } from '../lib/types';

/**
 * Adapter for Chrome's built-in Prompt API (Gemini Nano).
 *
 * Two shapes exist in the wild:
 *   - `LanguageModel.availability()` / `LanguageModel.create()`  (Chrome 138+)
 *   - `ai.languageModel.capabilities()` / `.create()`            (earlier origin trial)
 *
 * Both are normalised here so the rest of the app only sees a status and a
 * stream of text deltas. Streaming shape is normalised too: some builds yield
 * cumulative text ("Hel", "Hello"), others yield deltas ("Hel", "lo").
 */

export type BuiltInStatus =
  | 'available'
  | 'downloadable'
  | 'downloading'
  | 'unavailable'
  | 'unsupported';

interface BuiltInSession {
  promptStreaming(input: string): ReadableStream<string> | AsyncIterable<string>;
  destroy?: () => void;
}

interface BuiltInApi {
  create(options?: Record<string, unknown>): Promise<BuiltInSession>;
  availability?: () => Promise<string>;
  capabilities?: () => Promise<{ available?: string }>;
}

function getApi(): BuiltInApi | null {
  const scope = globalThis as unknown as {
    LanguageModel?: BuiltInApi;
    ai?: { languageModel?: BuiltInApi };
  };

  if (typeof scope.LanguageModel?.create === 'function') return scope.LanguageModel;
  if (typeof scope.ai?.languageModel?.create === 'function') return scope.ai.languageModel;
  return null;
}

export function mapAvailability(raw: string | undefined | null): BuiltInStatus {
  switch (raw) {
    case 'available':
    case 'readily':
      return 'available';
    case 'downloadable':
    case 'after-download':
      return 'downloadable';
    case 'downloading':
      return 'downloading';
    case 'unavailable':
    case 'no':
      return 'unavailable';
    default:
      return 'unsupported';
  }
}

export async function getBuiltInStatus(): Promise<BuiltInStatus> {
  const api = getApi();
  if (!api) return 'unsupported';

  try {
    if (typeof api.availability === 'function') {
      return mapAvailability(await api.availability());
    }
    if (typeof api.capabilities === 'function') {
      const capabilities = await api.capabilities();
      return mapAvailability(capabilities?.available);
    }
    // An API without a capability probe: assume it can create a session.
    return 'available';
  } catch {
    return 'unavailable';
  }
}

/**
 * True when the session rejected the prompt for exceeding its context window.
 * Gemini Nano's window is small, so callers retry with fewer excerpts.
 */
export function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'QuotaExceededError') return true;
  return /input is too large|too large|context (window|length)/i.test(error.message);
}

/**
 * Some Chromium shells (Electron, embedded webviews) expose the API but ship no
 * model: `prompt()` resolves with a canned sentence or echoes the input. Detect
 * the canned reply so the UI can explain instead of printing it as an answer.
 */
export function isMissingModelReply(text: string): boolean {
  return /on-device model is not available/i.test(text);
}

/** User-facing wording for errors coming out of the built-in model. */
export function describeBuiltInError(error: unknown): string {
  if (isQuotaError(error)) {
    return 'The built-in model’s context window is too small for even one passage. Lower “Passages per question” in Setup, ask a shorter question, or switch to the API provider.';
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Converts a stream that may yield cumulative snapshots into deltas.
 */
export function makeDeltaReader(): (chunk: string) => string {
  let seen = '';
  return (chunk: string) => {
    if (!chunk) return '';
    if (chunk.length >= seen.length && chunk.startsWith(seen)) {
      const delta = chunk.slice(seen.length);
      seen = chunk;
      return delta;
    }
    seen += chunk;
    return chunk;
  };
}

async function* toAsyncIterable(
  stream: ReadableStream<string> | AsyncIterable<string>,
): AsyncGenerator<string> {
  if (Symbol.asyncIterator in Object(stream)) {
    for await (const chunk of stream as AsyncIterable<string>) yield chunk;
    return;
  }

  const reader = (stream as ReadableStream<string>).getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function promptParts(messages: ChatMessage[]) {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const prompt = messages
    .filter((message) => message.role !== 'system')
    .map((message) => message.content)
    .join('\n\n');

  return { system, prompt };
}

async function createSession(
  messages: ChatMessage[],
  onProgress?: (fraction: number) => void,
): Promise<BuiltInSession> {
  const api = getApi();
  if (!api) {
    throw new Error(
      "This browser doesn't expose the built-in AI API. Use Chrome 138+ on desktop, or switch to the API provider.",
    );
  }

  const { system } = promptParts(messages);
  const options: Record<string, unknown> = {};

  if (system) options.initialPrompts = [{ role: 'system', content: system }];

  if (onProgress) {
    options.monitor = (monitor: EventTarget) => {
      monitor.addEventListener('downloadprogress', (event) => {
        const { loaded, total } = event as unknown as { loaded: number; total: number };
        if (total > 0) onProgress(loaded / total);
      });
    };
  }

  return api.create(options);
}

/** Trigger Chrome's model download (if needed) without generating anything. */
export async function prepareBuiltIn(onProgress?: (fraction: number) => void): Promise<void> {
  const session = await createSession([], onProgress);
  session.destroy?.();
}

export async function* streamBuiltIn(
  messages: ChatMessage[],
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): AsyncGenerator<string, void, unknown> {
  const session = await createSession(messages, options.onProgress);
  const { prompt } = promptParts(messages);
  const toDelta = makeDeltaReader();

  try {
    for await (const chunk of toAsyncIterable(session.promptStreaming(prompt))) {
      if (options.signal?.aborted) break;
      const delta = toDelta(String(chunk));
      if (delta) yield delta;
    }
  } finally {
    session.destroy?.();
  }
}
