/** Shared types for the main thread and the embedding worker. */

export interface ParsedDoc {
  docId: string;
  title: string;
  sourceName: string;
  mime: string;
  pages: { page: number; text: string }[];
}

export interface ChunkRecord {
  id: string;
  docId: string;
  docTitle: string;
  sourceName: string;
  ordinal: number;
  page: number;
  section: string;
  /** Clean text shown to the user and sent to the model. */
  text: string;
  /** Text actually embedded: section path + overlap tail + text. */
  embedText: string;
}

export interface DocSummary {
  docId: string;
  title: string;
  sourceName: string;
  chunkCount: number;
  addedAt: number;
  chars: number;
}

export interface SearchHit {
  chunk: ChunkRecord;
  denseScore: number;
  bm25Score: number;
  fusedScore: number;
  denseRank: number | null;
  bm25Rank: number | null;
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
  topDenseScore: number;
  vectorCount: number;
  tookMs: number;
  /** Which ranking strategy was applied. */
  approach: 'standard' | 'overview';
}

export interface RagStats {
  docs: DocSummary[];
  chunks: number;
  vectors: number;
  dims: number;
  model: string;
  backend: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
