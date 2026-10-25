import { describe, expect, it } from 'vitest';
import { chunkDoc, chunkPage, splitBlocks } from './chunk';
import type { ParsedDoc } from './types';

describe('splitBlocks', () => {
  it('tracks the heading hierarchy for each block', () => {
    const blocks = splitBlocks('# Guide\n\nIntro text.\n\n## Install\n\nRun the installer.');
    expect(blocks[0]).toMatchObject({ heading: true, section: 'Guide' });
    expect(blocks[1]).toMatchObject({ heading: false, section: 'Guide' });
    expect(blocks[3]).toMatchObject({ heading: false, section: 'Guide › Install' });
  });

  it('pops back up when heading depth decreases', () => {
    const blocks = splitBlocks('# A\n\ntext\n\n## B\n\ntext\n\n# C\n\ntext');
    const last = blocks[blocks.length - 1];
    expect(last.section).toBe('C');
  });
});

describe('chunkPage', () => {
  it('produces sequential ordinals and keeps the page number', () => {
    const paragraph = `${'Detailed sentence about the system. '.repeat(60)}`;
    const chunks = chunkPage(paragraph, 7);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.page)).toEqual(chunks.map(() => 7));
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it('merges a tiny trailing block into the previous chunk', () => {
    const body = `${'word '.repeat(200)}\n\nThe end.`;
    const chunks = chunkPage(body, 1);
    expect(chunks.some((chunk) => chunk.text === 'The end.')).toBe(false);
  });
});

describe('chunkDoc', () => {
  const doc: ParsedDoc = {
    docId: 'abc123',
    title: 'Handbook',
    sourceName: 'handbook.md',
    mime: 'text/markdown',
    pages: [
      { page: 1, text: '# Leave policy\n\nEmployees get 20 days of annual leave.' },
      { page: 2, text: '## Carried over\n\nUnused leave rolls over for three months.' },
    ],
  };

  it('creates stable, unique ids across pages', () => {
    const chunks = chunkDoc(doc);
    const ids = chunks.map((chunk) => chunk.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('abc123:0');
  });

  it('embeds the section path and carries an overlap tail forward', () => {
    const chunks = chunkDoc(doc);
    expect(chunks[0].embedText).toContain('Leave policy');
    expect(chunks[1].embedText).toContain('Carried over');
    expect(chunks[1].embedText).toContain('…');
    // The clean text used for citations must not contain the overlap marker.
    expect(chunks[1].text).not.toContain('…');
  });
});
