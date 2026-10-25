import { useCallback, useRef, useState } from 'react';
import type { RagClient } from '../lib/ragClient';
import { buildPrompt, MIN_RELEVANT_SCORE } from '../lib/prompts';
import { createOutputGuard, stopMessage, type StopReason } from '../lib/repeatGuard';
import type { SearchHit, SearchResult } from '../lib/types';
import { streamCompletion } from '../llm/openai';
import { interruptLocal, isModelLoaded, loadLocalModel, streamLocal } from '../llm/webllm';
import type { Settings } from './useSettings';

export interface ChatItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: SearchHit[];
  lowConfidence?: boolean;
  pending?: boolean;
  error?: string;
  /** Non-fatal note, e.g. why generation was cut short. */
  notice?: string;
  meta?: string;
}

export interface LocalModelState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  text: string;
  pct?: number;
}

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

function describeRetrieval(result: SearchResult): string {
  const best = Math.round(result.topDenseScore * 100);
  const approach = result.approach === 'overview' ? ' · overview ranking (front matter boosted)' : '';
  return `${result.hits.length} passages · ${result.vectorCount} chunks searched · ${result.tookMs} ms · best match ${best}%${approach}`;
}

export function useChat(client: RagClient, settings: Settings) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<LocalModelState>({ status: 'idle', text: '' });
  const abortRef = useRef<AbortController | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const ensureLocalModel = useCallback(async () => {
    const modelId = settingsRef.current.localModel;
    if (isModelLoaded(modelId)) return loadLocalModel(modelId, () => {});
    setLocal({ status: 'loading', text: 'Starting model download…', pct: 0 });
    try {
      const engine = await loadLocalModel(modelId, (text, pct) =>
        setLocal({ status: 'loading', text, pct }),
      );
      setLocal({ status: 'ready', text: 'Local model ready' });
      return engine;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocal({ status: 'error', text: message });
      throw error;
    }
  }, []);

  const preloadLocalModel = useCallback(async () => {
    try {
      await ensureLocalModel();
    } catch {
      /* surfaced through local state */
    }
  }, [ensureLocalModel]);

  const patch = useCallback((id: string, update: Partial<ChatItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...update } : item)));
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question) return;
      if (busy) return;

      const active = settingsRef.current;
      setBusy(true);
      setItems((prev) => [...prev, { id: uid(), role: 'user', content: question }]);

      const assistantId = uid();
      try {
        const result = await client.search(question, active.topK);

        if (result.vectorCount === 0) {
          setItems((prev) => [
            ...prev,
            {
              id: assistantId,
              role: 'assistant',
              content:
                'The index is empty. Drop a PDF, markdown file, or plain-text file into the Documents panel and ask again.',
            },
          ]);
          return;
        }

        if (result.hits.length === 0) {
          setItems((prev) => [
            ...prev,
            {
              id: assistantId,
              role: 'assistant',
              content: 'Nothing in the indexed documents matches that question.',
              meta: describeRetrieval(result),
            },
          ]);
          return;
        }

        const lowConfidence = result.topDenseScore < MIN_RELEVANT_SCORE;
        setItems((prev) => [
          ...prev,
          {
            id: assistantId,
            role: 'assistant',
            content: '',
            citations: result.hits,
            lowConfidence,
            pending: true,
            meta: describeRetrieval(result),
          },
        ]);

        const messages = buildPrompt(question, result.hits, lowConfidence);
        const controller = new AbortController();
        abortRef.current = controller;

        // Small models can lock into a copy loop when the excerpts are full of
        // repeated instruction-shaped sentences. Cut the stream when that happens.
        const guard = createOutputGuard(4000);

        const push = (delta: string) => {
          setItems((prev) =>
            prev.map((item) =>
              item.id === assistantId ? { ...item, content: item.content + delta } : item,
            ),
          );
        };

        const consume = async (source: AsyncIterable<string>): Promise<StopReason | null> => {
          for await (const delta of source) {
            push(delta);
            const verdict = guard.push(delta);
            if (verdict.stop) return verdict.reason ?? 'repetition';
          }
          return null;
        };

        let stopReason: StopReason | null = null;

        if (active.provider === 'api') {
          if (!active.apiKey.trim()) {
            throw new Error('Add an API key in Settings, or switch the provider back to the local model.');
          }
          stopReason = await consume(
            streamCompletion(
              messages,
              { apiKey: active.apiKey.trim(), baseUrl: active.baseUrl, model: active.model },
              controller.signal,
            ),
          );
          // Nothing will read the rest of the body, so release the connection.
          if (stopReason) controller.abort();
        } else {
          const engine = await ensureLocalModel();
          stopReason = await consume(streamLocal(engine, messages, controller.signal));
          if (stopReason) await interruptLocal(engine);
        }

        if (stopReason) {
          patch(assistantId, { notice: stopMessage(stopReason) });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const aborted = abortRef.current?.signal.aborted ?? false;
        setItems((prev) => {
          const exists = prev.some((item) => item.id === assistantId);
          if (!exists) {
            return [...prev, { id: assistantId, role: 'assistant', content: '', error: message }];
          }
          return prev.map((item) =>
            item.id === assistantId
              ? {
                  ...item,
                  pending: false,
                  error: aborted ? 'Stopped.' : message,
                }
              : item,
          );
        });
      } finally {
        setItems((prev) =>
          prev.map((item) =>
            item.id === assistantId ? { ...item, pending: false } : item,
          ),
        );
        abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, client, ensureLocalModel, patch],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setBusy(false);
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setItems([]);
    setBusy(false);
  }, []);

  const dismissLocalError = useCallback(() => {
    setLocal({ status: 'idle', text: '' });
  }, []);

  return { items, busy, local, send, stop, clear, preloadLocalModel, dismissLocalError, patch };
}
