/**
 * Reciprocal Rank Fusion: combine ranked lists from different retrievers
 * without needing their scores to be comparable.
 */
export function reciprocalRankFusion(lists: number[][], k = 60): Map<number, number> {
  const fused = new Map<number, number>();
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const docIndex = list[rank];
      fused.set(docIndex, (fused.get(docIndex) ?? 0) + 1 / (k + rank + 1));
    }
  }
  return fused;
}
