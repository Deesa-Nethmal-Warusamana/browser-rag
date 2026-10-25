/// <reference lib="webworker" />
import { pipeline } from '@huggingface/transformers';
import { chunkDoc } from '../lib/chunk';
import { buildBM25, searchBM25, type BM25Index } from '../lib/bm25';
import { isOverviewQuery, positionBoost, stripOverviewIntent } from '../lib/boost';
import { reciprocalRankFusion } from '../lib/fuse';
import {
  clearStoredDocs,
  deleteStoredDoc,
  loadStoredDocs,
  saveStoredDoc,
  type StoredDoc,
} from '../lib/db';
import type {
  ChunkRecord,
  DocSummary,
  ParsedDoc,
  RagStats,
  SearchHit,
  SearchResult,
} from '../lib/types';
import type { WorkerEvent, WorkerOut, WorkerRequestWithId } from '../lib/workerProtocol';

const MODEL = 'Xenova/bge-small-en-v1.5';
const DIMS = 384;
const BATCH_SIZE = 16;

const post = (message: WorkerOut) => (self as unknown as Worker).postMessage(message);
const status = (text: string, pct?: number) => post({ event: { kind: 'status', text, pct } });

type Embedder = (
  texts: string[],
  options: Record<string, unknown>,
) => Promise<{ data: Float32Array; dims: number[] }>;

let embedder: Embedder | null = null;
let embedderPromise: Promise<Embedder> | null = null;
let backend = 'initialising';

let chunks: ChunkRecord[] = [];
let vectors: Float32Array = new Float32Array(0);
let bm25: BM25Index = buildBM25([]);
let docs: DocSummary[] = [];
/** Highest page number seen per document, used for overview ranking. */
let docPages = new Map<string, number>();

/* ------------------------------------------------------------------ model */

function reportModelProgress(p: {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}) {
  if (p.status === 'progress' && typeof p.progress === 'number' && p.file) {
    status(`Downloading ${p.file}`, p.progress / 100);
  } else if (p.status === 'ready') {
    status('Embedding model ready');
  } else if (p.status === 'initiate' && p.file) {
    status(`Fetching ${p.file}`);
  }
}

async function loadEmbedder(): Promise<Embedder> {
  if (embedder) return embedder;
  if (embedderPromise) return embedderPromise;

  embedderPromise = (async () => {
    status('Loading embedding model…', 0);
    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

    if (hasWebGPU) {
      try {
        const model = await pipeline('feature-extraction', MODEL, {
          device: 'webgpu',
          dtype: 'q4',
          progress_callback: reportModelProgress,
        } as never);
        backend = 'webgpu';
        embedder = model as unknown as Embedder;
        status('Embedding model ready (WebGPU)');
        return embedder;
      } catch (error) {
        console.warn('[rag] WebGPU embedder unavailable, falling back to wasm', error);
      }
    }

    const model = await pipeline('feature-extraction', MODEL, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: reportModelProgress,
    } as never);
    backend = 'wasm';
    embedder = model as unknown as Embedder;
    status('Embedding model ready (wasm)');
    return embedder;
  })();

  return embedderPromise;
}

async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  const model = await loadEmbedder();
  const output = await model(texts, { pooling: 'cls', normalize: true });
  const dims = output.dims[output.dims.length - 1] ?? DIMS;
  const flat = output.data;
  const result: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    result.push(flat.slice(i * dims, (i + 1) * dims));
  }
  return result;
}

async function embedInBatches(
  texts: string[],
  onProgress?: (done: number) => void,
): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    out.push(...(await embedTexts(batch)));
    onProgress?.(Math.min(i + batch.length, texts.length));
  }
  return out;
}

/* ------------------------------------------------------------------ index */

function concatFloat32(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function rebuildLexicalIndex() {
  bm25 = buildBM25(chunks.map((c) => `${c.section} ${c.text}`));
}

async function reloadFromStorage(): Promise<void> {
  const stored = await loadStoredDocs();
  stored.sort((a, b) => a.addedAt - b.addedAt);

  const nextChunks: ChunkRecord[] = [];
  const nextVectors: Float32Array[] = [];
  const nextDocs: DocSummary[] = [];
  let skipped = 0;

  for (const record of stored) {
    if (record.model !== MODEL || record.dims !== DIMS) {
      skipped += 1;
      continue;
    }
    nextChunks.push(...record.chunks);
    nextVectors.push(new Float32Array(record.vectors));
    nextDocs.push({
      docId: record.docId,
      title: record.title,
      sourceName: record.sourceName,
      chunkCount: record.chunkCount,
      addedAt: record.addedAt,
      chars: record.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
    });
  }

  chunks = nextChunks;
  vectors = concatFloat32(nextVectors);
  docs = nextDocs;
  docPages = new Map();
  for (const chunk of nextChunks) {
    docPages.set(chunk.docId, Math.max(docPages.get(chunk.docId) ?? 0, chunk.page));
  }
  rebuildLexicalIndex();

  if (skipped > 0) {
    status(`${skipped} document(s) skipped — indexed with a different embedding model`);
  }
}

function stats(): RagStats {
  return {
    docs: [...docs],
    chunks: chunks.length,
    vectors: DIMS > 0 ? vectors.length / DIMS : 0,
    dims: DIMS,
    model: MODEL,
    backend,
  };
}

/* ----------------------------------------------------------------- search */

/**
 * Rank by cosine similarity, optionally reweighted towards the front of each
 * document for overview-shaped questions.
 */
function rankDense(
  query: Float32Array,
  limit: number,
  overview: boolean,
): { index: number; raw: number; score: number }[] {
  const count = chunks.length;
  const raw = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const base = i * DIMS;
    let sum = 0;
    for (let d = 0; d < DIMS; d++) sum += query[d] * vectors[base + d];
    raw[i] = sum;
  }
  const ranked = Array.from({ length: count }, (_, index) => {
    const chunk = chunks[index];
    const factor = overview
      ? positionBoost(chunk.page, docPages.get(chunk.docId) ?? 1)
      : 1;
    return { index, raw: raw[index], score: raw[index] * factor };
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}

async function search(query: string, k: number): Promise<SearchResult> {
  const started = performance.now();
  if (chunks.length === 0) {
    return {
      query,
      hits: [],
      topDenseScore: 0,
      vectorCount: 0,
      tookMs: 0,
      approach: isOverviewQuery(query) ? 'overview' : 'standard',
    };
  }

  const [queryVector] = await embedTexts([query]);
  const depth = Math.max(k * 4, 20);
  const overview = isOverviewQuery(query);
  const approach = overview ? 'overview' : 'standard';
  const denseHits = rankDense(queryVector, depth, overview);
  // On overview questions the query's own wording ("summarize", "thesis") is
  // intent, not content — matching it lexically just returns passages that talk
  // about summarising. Search the remainder, or skip the lexical retriever.
  const lexicalQuery = overview ? stripOverviewIntent(query) : query;
  const lexicalHits = lexicalQuery ? searchBM25(bm25, lexicalQuery, depth) : [];

  const fused = reciprocalRankFusion([
    denseHits.map((hit) => hit.index),
    lexicalHits.map((hit) => hit.index),
  ]);

  const denseRanks = new Map(denseHits.map((hit, rank) => [hit.index, rank]));
  const lexicalRanks = new Map(lexicalHits.map((hit, rank) => [hit.index, rank]));
  const lexicalScores = new Map(lexicalHits.map((hit) => [hit.index, hit.score]));
  const denseScores = new Map(denseHits.map((hit) => [hit.index, hit.raw]));
  const topDenseScore = denseHits.reduce((best, hit) => Math.max(best, hit.raw), 0);

  const hits: SearchHit[] = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([index, fusedScore]) => ({
      chunk: chunks[index],
      denseScore: denseScores.get(index) ?? 0,
      bm25Score: lexicalScores.get(index) ?? 0,
      fusedScore,
      denseRank: denseRanks.get(index) ?? null,
      bm25Rank: lexicalRanks.get(index) ?? null,
    }));

  return {
    query,
    hits,
    topDenseScore,
    vectorCount: chunks.length,
    tookMs: Math.round(performance.now() - started),
    approach,
  };
}

/* ------------------------------------------------------------------ ingest */

async function ingest(doc: ParsedDoc) {
  const records = chunkDoc(doc);
  if (records.length === 0) {
    throw new Error(`No extractable text found in ${doc.sourceName}`);
  }

  status(`Embedding ${records.length} chunks from ${doc.title}…`, 0);
  const embedded = await embedInBatches(records.map((r) => r.embedText), (done) => {
    status(`Embedding ${doc.title}`, done / records.length);
  });

  const flat = concatFloat32(embedded);
  const record: StoredDoc = {
    docId: doc.docId,
    title: doc.title,
    sourceName: doc.sourceName,
    chunkCount: records.length,
    addedAt: Date.now(),
    model: MODEL,
    dims: DIMS,
    chunks: records,
    vectors: flat.buffer.slice(0) as unknown as ArrayBuffer,
  };

  await saveStoredDoc(record);
  await reloadFromStorage();
  status(`Indexed ${doc.title} (${records.length} chunks)`);
  return { ...stats(), docId: doc.docId };
}

/* ------------------------------------------------------------- dispatcher */

async function handle(request: WorkerRequestWithId): Promise<unknown> {
  switch (request.type) {
    case 'init': {
      await loadEmbedder();
      await reloadFromStorage();
      post({ event: { kind: 'backend', backend, model: MODEL } });
      return stats();
    }
    case 'ingest':
      return ingest(request.doc);
    case 'search':
      return search(request.query, request.k);
    case 'remove-doc':
      await deleteStoredDoc(request.docId);
      await reloadFromStorage();
      return stats();
    case 'clear':
      await clearStoredDocs();
      await reloadFromStorage();
      return stats();
    case 'stats':
      return stats();
    default:
      throw new Error('Unknown worker request');
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerRequestWithId>) => {
  const request = event.data;
  handle(request)
    .then((result) => post({ id: request.id, ok: true, result }))
    .catch((error: unknown) => {
      console.error('[rag worker]', error);
      post({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
});

// Warm the model as soon as the worker boots so the progress bar is real.
void loadEmbedder().catch((error: unknown) => {
  status(`Failed to load embedding model: ${error instanceof Error ? error.message : String(error)}`);
});

export type { WorkerEvent };
