import type { MLCEngine } from '@mlc-ai/web-llm';
import type { ChatMessage } from '../lib/types';

export function hasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

let cached: { modelId: string; engine: Promise<MLCEngine> } | null = null;

export function isModelLoaded(modelId: string): boolean {
  return cached?.modelId === modelId;
}

/**
 * Download and initialise an MLC model. Weights are cached by the browser after
 * the first load, so this is only slow once per browser profile.
 */
export async function loadLocalModel(
  modelId: string,
  onProgress: (text: string, progress: number) => void,
): Promise<MLCEngine> {
  if (!hasWebGPU()) {
    throw new Error(
      'WebGPU is not available in this browser. Use Chrome/Edge, or switch to the API provider.',
    );
  }
  if (cached?.modelId === modelId) return cached.engine;

  const engine = (async () => {
    const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
    return CreateMLCEngine(modelId, {
      initProgressCallback: (report) => onProgress(report.text, report.progress ?? 0),
    });
  })();

  cached = { modelId, engine };
  return engine;
}

export async function* streamLocal(
  engine: MLCEngine,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const stream = await engine.chat.completions.create({
    messages: messages as never,
    stream: true,
    temperature: 0.2,
    max_tokens: 700,
  });

  for await (const chunk of stream) {
    if (signal?.aborted) break;
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) yield delta;
  }
}

/** Stop an in-flight generation; the engine keeps running until told otherwise. */
export async function interruptLocal(engine: MLCEngine): Promise<void> {
  try {
    await engine.interruptGenerate();
  } catch {
    /* nothing in flight */
  }
}

export async function unloadLocalModel(): Promise<void> {
  if (!cached) return;
  const engine = await cached.engine.catch(() => null);
  cached = null;
  await engine?.unload();
}
