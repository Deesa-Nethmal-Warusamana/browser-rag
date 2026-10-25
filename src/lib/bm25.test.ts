import { describe, expect, it } from 'vitest';
import { buildBM25, searchBM25, tokenize } from './bm25';
import { reciprocalRankFusion } from './fuse';

describe('tokenize', () => {
  it('lowercases and keeps alphanumerics', () => {
    expect(tokenize('HTTP 404 — Not Found!')).toEqual(['http', '404', 'not', 'found']);
  });
});

describe('BM25', () => {
  const corpus = [
    'The deploy pipeline runs on every merge to main.',
    'Rotate the signing keys every ninety days.',
    'The ingest service returns 404 when the manifest path is wrong.',
    'Nothing about cooking pasta here.',
  ];
  const index = buildBM25(corpus);

  it('ranks the passage containing the rare terms first', () => {
    const [top] = searchBM25(index, 'signing keys rotation', 3);
    expect(corpus[top.index]).toContain('signing keys');
  });

  it('matches exact identifiers that embeddings often miss', () => {
    const [top] = searchBM25(index, '404-error', 3);
    expect(top).toBeDefined();
    expect(corpus[top.index]).toContain('404') ;
  });

  it('returns nothing for an empty or stopword-only query', () => {
    expect(searchBM25(index, 'the and of', 5)).toEqual([]);
    expect(searchBM25(buildBM25([]), 'anything', 5)).toEqual([]);
  });
});

describe('reciprocal rank fusion', () => {
  it('rewards documents ranked highly by either retriever', () => {
    const fused = reciprocalRankFusion([
      [0, 1, 2],
      [2, 0, 3],
    ]);
    const ordered = [...fused.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i);
    expect(ordered.slice(0, 2)).toEqual([0, 2]);
    expect(fused.has(3)).toBe(true);
  });

  it('handles an empty list', () => {
    expect(reciprocalRankFusion([]).size).toBe(0);
    expect(reciprocalRankFusion([[], []]).size).toBe(0);
  });
});
