import type { DocSummary, ParsedDoc, RagStats, SearchResult } from './types';
import type {
  IngestResult,
  WorkerEvent,
  WorkerOut,
  WorkerRequest,
} from './workerProtocol';

export type RagListener = (event: WorkerEvent) => void;

/**
 * Promise-based RPC wrapper around the embedding worker.
 * The worker owns the model, the vectors and IndexedDB, so large arrays never
 * cross the main-thread boundary.
 */
export class RagClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private listeners = new Set<RagListener>();
  private disposed = false;

  constructor() {
    this.worker = new Worker(new URL('../workers/embed.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.addEventListener('message', (event: MessageEvent<WorkerOut>) => {
      const message = event.data;
      if ('event' in message) {
        for (const listener of this.listeners) listener(message.event);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error));
    });
    this.worker.addEventListener('error', (event) => {
      const error = new Error(event.message || 'Embedding worker crashed');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      for (const listener of this.listeners) {
        listener({ kind: 'status', text: `Worker error: ${error.message}` });
      }
    });
  }

  on(listener: RagListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private call<T>(request: WorkerRequest): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('RAG client disposed'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ ...request, id });
    });
  }

  init(): Promise<RagStats> {
    return this.call<RagStats>({ type: 'init' });
  }

  ingest(doc: ParsedDoc): Promise<IngestResult> {
    return this.call<IngestResult>({ type: 'ingest', doc });
  }

  search(query: string, k = 6): Promise<SearchResult> {
    return this.call<SearchResult>({ type: 'search', query, k });
  }

  removeDoc(docId: string): Promise<RagStats> {
    return this.call<RagStats>({ type: 'remove-doc', docId });
  }

  clear(): Promise<RagStats> {
    return this.call<RagStats>({ type: 'clear' });
  }

  stats(): Promise<RagStats> {
    return this.call<RagStats>({ type: 'stats' });
  }

  dispose(): void {
    this.disposed = true;
    this.worker.terminate();
  }
}

export type { DocSummary };
