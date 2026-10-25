import { useCallback, useEffect, useRef, useState } from 'react';
import type { RagClient } from '../lib/ragClient';
import { buildPrompt, MIN_RELEVANT_SCORE } from '../lib/prompts';
import { createOutputGuard, stopMessage, type StopReason } from '../lib/repeatGuard';
import type { SearchHit, SearchResult } from '../lib/types';
import { streamCompletion } from '../llm/openai';
import {
  describeBuiltInError,
  getBuiltInStatus,
  isMissingModelReply,
  isQuotaError,
  prepareBuiltIn,
  streamBuiltIn,
  type BuiltInStatus,
} from '../llm/builtinAI';
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

export interface BuiltInState {
  status: BuiltInStatus | 'checking';
  /** Download progress, 0-1, when Chrome is fetching the model. */
  pct?: number;
  detail?: string;
}

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

function describeRetrieval(result: SearchResult, hitCount = result.hits.length): string {
  const best = Math.round(result.topDenseScore * 100);
  const passages = `${hitCount} passage${hitCount === 1 ? '' : 's'}`;
  const approach =
    result.approach === 'overview' ? ' · overview ranking (front matter boosted)' : '';
  return `${passages} · ${result.vectorCount} chunks searched · ${result.tookMs} ms · best match ${best}%${approach}`;
}

function builtInUnavailableMessage(status: BuiltInStatus): string {
  if (status === 'downloadable' || status === 'downloading') {
    return 'Chrome has not finished preparing its built-in model. Open Setup → Built-in, click “Enable built-in model”, then ask again.';
  }
  if (status === 'unsupported') {
    return "This browser doesn't expose the built-in AI API. Use Chrome 138+ on desktop, or switch to the API provider in Setup.";
  }
  return 'The built-in model is unavailable on this device. Switch to the API provider in Setup, or free up disk space and retry.';
}

export function useChat(client: RagClient, settings: Settings) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [builtin, setBuiltin] = useState<BuiltInState>({ status: 'checking' });
  const abortRef = useRef<AbortController | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const refreshBuiltIn = useCallback(async () => {
    setBuiltin((current) => (current.status === 'checking' ? current : { status: 'checking' }));
    try {
      const status = await getBuiltInStatus();
      setBuiltin({ status });
    } catch (error) {
      setBuiltin({
        status: 'unavailable',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    void refreshBuiltIn();
  }, [refreshBuiltIn]);

  /** Ask Chrome to download the model now rather than on the first question. */
  const enableBuiltIn = useCallback(async () => {
    setBuiltin({ status: 'downloading', pct: 0 });
    try {
      await prepareBuiltIn((pct) => setBuiltin({ status: 'downloading', pct }));
      const status = await getBuiltInStatus();
      setBuiltin({ status });
    } catch (error) {
      setBuiltin({
        status: 'unavailable',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

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
            throw new Error(
              'Add an API key in Setup, or switch the provider back to the built-in model.',
            );
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
          const status = await getBuiltInStatus();
          if (status !== 'available') throw new Error(builtInUnavailableMessage(status));

          // Gemini Nano's context window is small: if the prompt is rejected,
          // drop the weakest passages and try again before giving up.
          let hits = result.hits;
          for (let attempt = 0; ; attempt++) {
            try {
              stopReason = await consume(
                streamBuiltIn(buildPrompt(question, hits, lowConfidence), {
                  signal: controller.signal,
                  onProgress: (pct) => setBuiltin({ status: 'downloading', pct }),
                }),
              );
              break;
            } catch (error) {
              if (!isQuotaError(error)) throw error;
              // Gemini Nano's window is small: drop the weakest passages and retry,
              // then explain in plain language rather than showing the raw error.
              if (hits.length <= 1 || attempt >= 3) throw new Error(describeBuiltInError(error));
              hits = hits.slice(0, Math.max(1, Math.ceil(hits.length / 2)));
              patch(assistantId, {
                content: '',
                citations: hits,
                meta: describeRetrieval(result, hits.length),
              });
            }
          }

          if (isMissingModelReply(guard.text)) {
            throw new Error(
              'This browser exposes the built-in AI API but ships no model — common in Electron and embedded webview builds. Open the app in Chrome 138+ on desktop, or switch to the API provider in Setup.',
            );
          }
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
          prev.map((item) => (item.id === assistantId ? { ...item, pending: false } : item)),
        );
        abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, client, patch],
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

  return { items, busy, builtin, send, stop, clear, refreshBuiltIn, enableBuiltIn };
}
