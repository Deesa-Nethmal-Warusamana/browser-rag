/**
 * A small, dependency-free BM25 index. Runs in the worker next to the dense
 * index so retrieval can be hybrid without any native vector database.
 */

const STOPWORDS = new Set(
  (
    'a an and are as at be but by for from has have how i if in into is it its of on or ' +
    'that the their then there these this to was were what when where which who why will with you your'
  ).split(' '),
);

export interface BM25Index {
  n: number;
  avgLen: number;
  lengths: Int32Array;
  /** term -> (chunk index -> term frequency) */
  postings: Map<string, Map<number, number>>;
}

export interface BM25Hit {
  index: number;
  score: number;
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export function buildBM25(texts: string[]): BM25Index {
  const n = texts.length;
  const lengths = new Int32Array(n);
  const postings = new Map<string, Map<number, number>>();
  let total = 0;

  for (let i = 0; i < n; i++) {
    const tokens = tokenize(texts[i]).filter((t) => !STOPWORDS.has(t));
    lengths[i] = tokens.length;
    total += tokens.length;
    for (const token of tokens) {
      let posting = postings.get(token);
      if (!posting) {
        posting = new Map();
        postings.set(token, posting);
      }
      posting.set(i, (posting.get(i) ?? 0) + 1);
    }
  }

  return { n, avgLen: n > 0 ? total / n : 0, lengths, postings };
}

export function searchBM25(
  index: BM25Index,
  query: string,
  limit: number,
  k1 = 1.2,
  b = 0.75,
): BM25Hit[] {
  const terms = [...new Set(tokenize(query).filter((t) => !STOPWORDS.has(t)))];
  if (index.n === 0 || terms.length === 0) return [];

  const scores = new Map<number, number>();
  for (const term of terms) {
    const posting = index.postings.get(term);
    if (!posting) continue;
    const df = posting.size;
    const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
    for (const [docIndex, tf] of posting) {
      const norm = 1 - b + b * (index.lengths[docIndex] / (index.avgLen || 1));
      const score = idf * ((tf * (k1 + 1)) / (tf + k1 * norm));
      scores.set(docIndex, (scores.get(docIndex) ?? 0) + score);
    }
  }

  return [...scores.entries()]
    .map(([index_, score]) => ({ index: index_, score }))
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}
