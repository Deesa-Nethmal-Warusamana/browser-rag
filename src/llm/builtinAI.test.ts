import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getBuiltInStatus,
  isMissingModelReply,
  isQuotaError,
  makeDeltaReader,
  mapAvailability,
  streamBuiltIn,
} from './builtinAI';

afterEach(() => {
  vi.unstubAllGlobals();
});

function asyncStream(chunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

describe('mapAvailability', () => {
  it('maps the current API vocabulary', () => {
    expect(mapAvailability('available')).toBe('available');
    expect(mapAvailability('downloadable')).toBe('downloadable');
    expect(mapAvailability('downloading')).toBe('downloading');
    expect(mapAvailability('unavailable')).toBe('unavailable');
  });

  it('maps the earlier origin-trial vocabulary', () => {
    expect(mapAvailability('readily')).toBe('available');
    expect(mapAvailability('after-download')).toBe('downloadable');
    expect(mapAvailability('no')).toBe('unavailable');
  });

  it('treats unknown or missing values as unsupported', () => {
    expect(mapAvailability(undefined)).toBe('unsupported');
    expect(mapAvailability('')).toBe('unsupported');
    expect(mapAvailability('something-new')).toBe('unsupported');
  });
});

describe('getBuiltInStatus', () => {
  it('reports unsupported when the browser exposes nothing', async () => {
    vi.stubGlobal('LanguageModel', undefined);
    await expect(getBuiltInStatus()).resolves.toBe('unsupported');
  });

  it('reads availability() when present', async () => {
    vi.stubGlobal('LanguageModel', {
      create: async () => ({ promptStreaming: () => asyncStream([]) }),
      availability: async () => 'downloadable',
    });
    await expect(getBuiltInStatus()).resolves.toBe('downloadable');
  });

  it('falls back to capabilities() from the origin-trial shape', async () => {
    vi.stubGlobal('ai', {
      languageModel: {
        create: async () => ({ promptStreaming: () => asyncStream([]) }),
        capabilities: async () => ({ available: 'readily' }),
      },
    });
    await expect(getBuiltInStatus()).resolves.toBe('available');
  });
});

describe('makeDeltaReader', () => {
  it('turns cumulative snapshots into deltas', () => {
    const read = makeDeltaReader();
    expect(['Hel', 'Hello', 'Hello there'].map(read)).toEqual(['Hel', 'lo', ' there']);
  });

  it('passes through streams that already yield deltas', () => {
    const read = makeDeltaReader();
    expect(['Hel', 'lo', ' there'].map(read)).toEqual(['Hel', 'lo', ' there']);
  });

  it('ignores empty chunks and never loses text', () => {
    const read = makeDeltaReader();
    expect(['', 'abc', ''].map(read).join('')).toBe('abc');
  });

  it('does not duplicate text when a cumulative chunk repeats itself', () => {
    const read = makeDeltaReader();
    expect([read('abc'), read('abc'), read('abcd')].join('')).toBe('abcd');
  });
});

describe('streamBuiltIn', () => {
  const messages = [
    { role: 'system' as const, content: 'SYSTEM RULES' },
    { role: 'user' as const, content: 'THE QUESTION' },
  ];

  it('passes the system prompt as initialPrompts and the question as the prompt', async () => {
    const create = vi.fn(async () => ({
      promptStreaming: vi.fn(() => asyncStream(['ok'])),
    }));
    vi.stubGlobal('LanguageModel', { create });

    const chunks: string[] = [];
    for await (const chunk of streamBuiltIn(messages)) chunks.push(chunk);

    expect(chunks.join('')).toBe('ok');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ initialPrompts: [{ role: 'system', content: 'SYSTEM RULES' }] }),
    );
    const session = await create.mock.results[0].value;
    expect(session.promptStreaming).toHaveBeenCalledWith('THE QUESTION');
  });

  it('destroys the session even when the stream throws', async () => {
    const destroy = vi.fn();
    vi.stubGlobal('LanguageModel', {
      create: async () => ({
        promptStreaming: () => ({
          async *[Symbol.asyncIterator]() {
            yield 'a';
            throw new Error('boom');
          },
        }),
        destroy,
      }),
    });

    await expect(
      (async () => {
        for await (const _chunk of streamBuiltIn(messages)) void _chunk;
      })(),
    ).rejects.toThrow('boom');
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('handles a ReadableStream that is not async-iterable', async () => {
    const chunks = ['Hel', 'Hello'];
    let index = 0;
    vi.stubGlobal('LanguageModel', {
      create: async () => ({
        promptStreaming: () => ({
          getReader: () => ({
            read: async () =>
              index < chunks.length
                ? { done: false, value: chunks[index++] }
                : { done: true, value: undefined },
            releaseLock: () => {},
          }),
        }),
      }),
    });

    const out: string[] = [];
    for await (const chunk of streamBuiltIn(messages)) out.push(chunk);
    expect(out.join('')).toBe('Hello');
  });

  it('stops when the signal aborts', async () => {
    const controller = new AbortController();
    vi.stubGlobal('LanguageModel', {
      create: async () => ({
        promptStreaming: () => asyncStream(['one', 'two', 'three']),
        destroy: () => {},
      }),
    });

    const out: string[] = [];
    for await (const chunk of streamBuiltIn(messages, { signal: controller.signal })) {
      out.push(chunk);
      controller.abort();
    }
    expect(out).toEqual(['one']);
  });
});

describe('isQuotaError', () => {
  it('recognises the context-window rejection', () => {
    const quota = new Error('The input is too large.');
    quota.name = 'QuotaExceededError';
    expect(isQuotaError(quota)).toBe(true);
    expect(isQuotaError(new Error('input is too large'))).toBe(true);
    expect(isQuotaError(new Error('network down'))).toBe(false);
    expect(isQuotaError('nope')).toBe(false);
  });
});

describe('isMissingModelReply', () => {
  it('recognises the canned reply from shells without a model', () => {
    expect(isMissingModelReply('On-device model is not available in Chrome.')).toBe(true);
    expect(isMissingModelReply('Feature work pauses at 75 percent of the budget.')).toBe(false);
  });
});
