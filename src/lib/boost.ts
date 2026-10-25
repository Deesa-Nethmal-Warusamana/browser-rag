/**
 * Overview-shaped questions ("summarise the thesis", "what is this report
 * about") should look at the start of a document, where titles, abstracts and
 * introductions live. Dense similarity alone does not encode document position,
 * so it happily ranks an appendix that merely *talks about* summarising first.
 *
 * This is a deliberate, narrow heuristic: it only fires for detected overview
 * intent and only reweights the first fifth of a document. It is a candidate for
 * the eval harness to confirm or reject.
 */

const DOC_NOUN =
  '(?:paper|article|report|document|doc|book|thesis|readme|file|repo(?:sitory)?|codebase|handbook|guide|spec(?:ification)?|notes?)';

const OVERVIEW_PATTERN = new RegExp(
  [
    '\\b(?:thesis|abstract|tl;?dr|overview)\\b',
    '\\bmain\\s+(?:idea|point|argument|finding|contribution|takeaway)s?\\b',
    `\\bsummar(?:y|ies|ise|ize|ised|ized|ising|izing)\\s+(?:this|the)\\s+${DOC_NOUN}\\b`,
    `\\bwhat(?:'s|\\s+is)\\s+(?:this|the)\\s+${DOC_NOUN}\\s+about\\b`,
    '\\bsummar(?:ise|ize)\\s+(?:it|them)\\b',
  ].join('|'),
  'i',
);

/** Fraction of the document treated as "front matter". */
const FRONT_MATTER = 0.2;
/** Maximum score multiplier at the very first page. */
const MAX_BOOST = 0.25;

export function isOverviewQuery(query: string): boolean {
  return OVERVIEW_PATTERN.test(query);
}

/**
 * Intent words are the problem with lexical search on overview questions:
 * "summarize the thesis" matches any passage that merely *discusses*
 * summarising. Strip the intent vocabulary before the BM25 lookup so the
 * lexical retriever searches for subject matter instead of the task.
 */
const INTENT_TERMS =
  /\b(summar(?:y|ies|ise|ize|ised|ized|ising|izing)|overview|tl;?dr|abstract|main|idea|ideas|point|points|argument|arguments|finding|findings|contribution|contributions|takeaway|takeaways|thesis|this|that|the|a|an|paper|article|report|document|doc|book|readme|file|files|repo|repository|codebase|handbook|guide|spec|specification|notes|about|it|them|of|is|are|was|were|what|whats|can|could|would|will|do|does|did|please|give|tell|show|explain|me|us|you|your)\b/gi;

export function stripOverviewIntent(query: string): string {
  return query
    .replace(INTENT_TERMS, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Multiplier applied to a chunk's similarity score based on how early it sits in
 * its document. Returns 1 outside the front matter so most ranking is untouched.
 */
export function positionBoost(page: number, pageCount: number): number {
  if (pageCount <= 1) return 1;
  const position = (Math.max(1, page) - 1) / (pageCount - 1);
  if (position >= FRONT_MATTER) return 1;
  return 1 + MAX_BOOST * (1 - position / FRONT_MATTER);
}
