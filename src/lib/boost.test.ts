import { describe, expect, it } from 'vitest';
import { isOverviewQuery, positionBoost, stripOverviewIntent } from './boost';

describe('isOverviewQuery', () => {
  it('detects document-level summary questions', () => {
    expect(isOverviewQuery('Summarize the thesis')).toBe(true);
    expect(isOverviewQuery('can you summarize the thesis?')).toBe(true);
    expect(isOverviewQuery('Give me an overview of this document')).toBe(true);
    expect(isOverviewQuery('What is this report about?')).toBe(true);
    expect(isOverviewQuery('summarise the paper please')).toBe(true);
    expect(isOverviewQuery('what are the main findings')).toBe(true);
    expect(isOverviewQuery('tl;dr')).toBe(true);
  });

  it('ignores questions about a specific subtopic', () => {
    expect(isOverviewQuery('How do I rotate the signing keys?')).toBe(false);
    expect(isOverviewQuery('summarize the deployment policy')).toBe(false);
    expect(isOverviewQuery('What does section 3 say about severity 1 incidents?')).toBe(false);
    expect(isOverviewQuery('list the retention periods')).toBe(false);
  });
});

describe('positionBoost', () => {  it('boosts the first page most and decays to no boost at the front-matter edge', () => {
    const first = positionBoost(1, 100);
    const mid = positionBoost(10, 100);
    const lastInside = positionBoost(20, 100);
    const firstOutside = positionBoost(21, 100);

    expect(first).toBeCloseTo(1.25, 5);
    expect(mid).toBeLessThan(first);
    expect(mid).toBeGreaterThan(1);
    // Page 20 of 100 sits just inside the first fifth, page 21 just outside it.
    expect(lastInside).toBeGreaterThan(1);
    expect(lastInside).toBeLessThan(1.02);
    expect(firstOutside).toBe(1);
  });

  it('never boosts outside the front matter', () => {
    expect(positionBoost(50, 100)).toBe(1);
    expect(positionBoost(99, 100)).toBe(1);
  });

  it('is a no-op for single-page documents', () => {
    expect(positionBoost(1, 1)).toBe(1);
  });

  it('monotonically decreases through the front matter', () => {
    const values = [1, 2, 3, 4, 5].map((page) => positionBoost(page, 25));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    }
  });
});

describe('stripOverviewIntent', () => {
  it('removes the words that express the task rather than the subject', () => {
    expect(stripOverviewIntent('Summarize the thesis')).toBe('');
    expect(stripOverviewIntent('Can you summarize the paper?')).toBe('');
    expect(stripOverviewIntent('what is this report about')).toBe('');
  });

  it('keeps the subject matter so lexical search still has something to match', () => {
    expect(stripOverviewIntent('give me an overview of the incident response process')).toBe(
      'incident response process',
    );
    expect(stripOverviewIntent('what are the main findings on signing key rotation')).toBe(
      'on signing key rotation',
    );
  });
});
