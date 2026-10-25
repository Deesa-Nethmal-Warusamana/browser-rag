import { describe, expect, it } from 'vitest';
import { createOutputGuard, stopMessage } from './repeatGuard';

const LOOP_SENTENCE = 'Summarize the conversation in 3 sentences or fewer in English. ';

describe('createOutputGuard', () => {
  it('stops once the same sentence repeats', () => {
    const guard = createOutputGuard(100_000);
    let verdict = guard.push('');

    for (let i = 0; i < 12 && !verdict.stop; i++) {
      verdict = guard.push(LOOP_SENTENCE);
    }

    expect(verdict.stop).toBe(true);
    expect(verdict.reason).toBe('repetition');
  });

  it('lets ordinary varied prose through', () => {
    const guard = createOutputGuard(100_000);
    const paragraph =
      'Feature work pauses once a team burns seventy five percent of its monthly error budget. ' +
      'Signing keys rotate every ninety days and require a second engineer to confirm the cutover. ' +
      'Deployments reach production only after a fifteen minute soak test in staging. ' +
      'Audit logs are immutable and retained for seven years, while application logs expire after thirty days.';

    let verdict = guard.push('');
    for (let i = 0; i < paragraph.length; i += 9) {
      verdict = guard.push(paragraph.slice(i, i + 9));
    }

    expect(verdict.stop).toBe(false);
  });

  it('stops on the length cap', () => {
    const guard = createOutputGuard(200);
    let verdict = guard.push('');
    let counter = 0;
    while (!verdict.stop && counter < 100) {
      verdict = guard.push(`distinct token ${counter * 7919} `);
      counter += 1;
    }
    expect(verdict.stop).toBe(true);
    expect(verdict.reason).toBe('length');
  });

  it('accumulates the text it has seen', () => {
    const guard = createOutputGuard(1000);
    guard.push('abc');
    guard.push('def');
    expect(guard.text).toBe('abcdef');
    expect(guard.length).toBe(6);
  });
});

describe('stopMessage', () => {
  it('explains both stop reasons', () => {
    expect(stopMessage('repetition')).toMatch(/repeating itself/i);
    expect(stopMessage('length')).toMatch(/length limit/i);
  });
});
