import type { ParsedDoc, SearchResult, RagStats } from './types';

export type WorkerRequest =
  | { type: 'init' }
  | { type: 'ingest'; doc: ParsedDoc }
  | { type: 'search'; query: string; k: number }
  | { type: 'remove-doc'; docId: string }
  | { type: 'clear' }
  | { type: 'stats' };

export type WorkerRequestWithId = WorkerRequest & { id: number };

export type WorkerEvent =
  | { kind: 'status'; text: string; pct?: number }
  | { kind: 'backend'; backend: string; model: string };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

export type WorkerOut = WorkerResponse | { event: WorkerEvent };

export interface IngestResult extends RagStats {
  docId: string;
}

export type WorkerResults = {
  init: RagStats;
  ingest: IngestResult;
  search: SearchResult;
  'remove-doc': RagStats;
  clear: RagStats;
  stats: RagStats;
};
