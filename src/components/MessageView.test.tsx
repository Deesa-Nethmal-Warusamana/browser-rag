// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MessageView } from './MessageView';
import type { ChatItem } from '../hooks/useChat';
import type { SearchHit } from '../lib/types';

const citation: SearchHit = {
  chunk: {
    id: 'doc:0',
    docId: 'doc',
    docTitle: 'Handbook',
    sourceName: 'handbook.md',
    ordinal: 0,
    page: 3,
    section: 'Incident response',
    text: 'Feature work pauses at 75 percent of the monthly error budget.',
    embedText: '',
  },
  denseScore: 0.71,
  bm25Score: 2.1,
  fusedScore: 0.03,
  denseRank: 0,
  bm25Rank: 1,
};

function assistant(content: string): ChatItem {
  return { id: 'm1', role: 'assistant', content, citations: [citation] };
}

describe('MessageView citations', () => {
  it('renders [n] markers as clickable chips, not broken links', () => {
    const { container } = render(
      <MessageView item={assistant('Feature work pauses at 75 percent [1].')} />,
    );

    const chip = container.querySelector('.cite-chip');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe('1');
    // Regression: react-markdown's default URL transform used to strip the
    // `cite:` scheme, leaving an empty anchor that pointed at the page itself.
    expect(container.querySelector('a')).toBeNull();
  });

  it('leaves out-of-range citations as plain text', () => {
    const { container } = render(<MessageView item={assistant('Only one source exists [9].')} />);
    expect(container.querySelector('.cite-chip')).toBeNull();
    expect(container.textContent).toContain('[9]');
  });

  it('still renders real links, and still blocks javascript: URLs', () => {
    const { container } = render(
      <MessageView item={assistant('See [the docs](https://example.com) and [bad](javascript:alert(1)).')} />,
    );
    const links = [...container.querySelectorAll('a')];
    expect(links.some((a) => a.getAttribute('href') === 'https://example.com')).toBe(true);
    expect(links.some((a) => (a.getAttribute('href') ?? '').startsWith('javascript:'))).toBe(false);
  });
});
