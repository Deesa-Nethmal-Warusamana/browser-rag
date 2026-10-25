import { useMemo, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { linkifyCitations } from '../lib/citations';
import type { ChatItem } from '../hooks/useChat';

/**
 * react-markdown sanitises link targets through `defaultUrlTransform`, which
 * strips unknown schemes — including our internal `cite:` anchors. Pass those
 * through untouched and let everything else keep the safe default.
 */
function keepCitationLinks(url: string): string {
  return url.startsWith('cite:') ? url : defaultUrlTransform(url);
}

function TypingDots() {
  return (
    <span className="typing" aria-label="Thinking">
      <span />
      <span />
      <span />
    </span>
  );
}

export function MessageView({ item }: { item: ChatItem }) {
  const [openSources, setOpenSources] = useState(false);
  const [activeSource, setActiveSource] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const copyAnswer = async () => {
    try {
      await navigator.clipboard.writeText(item.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  const citations = item.citations ?? [];
  const content = useMemo(
    () => linkifyCitations(item.content, citations.length),
    [item.content, citations.length],
  );

  const revealSource = (index: number) => {
    setOpenSources(true);
    setActiveSource(index);
    requestAnimationFrame(() => {
      document
        .getElementById(`source-${item.id}-${index}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  return (
    <article className={`msg msg-${item.role}`}>
      <div className="msg-role">{item.role === 'user' ? 'You' : 'Assistant'}</div>
      <div className="msg-body">
        {item.role === 'user' ? (
          <p className="plain">{item.content}</p>
        ) : (
          <>
            {item.content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={keepCitationLinks}
                components={{
                  a({ href, children }) {
                    if (href?.startsWith('cite:')) {
                      const index = Number(href.slice(5));
                      return (
                        <button
                          type="button"
                          className="cite-chip"
                          onClick={() => revealSource(index)}
                          title="Jump to source"
                        >
                          {children}
                        </button>
                      );
                    }
                    return (
                      <a href={href} target="_blank" rel="noreferrer noopener">
                        {children}
                      </a>
                    );
                  },
                  table({ children }) {
                    return (
                      <div className="md-table">
                        <table>{children}</table>
                      </div>
                    );
                  },
                }}
              >
                {content}
              </ReactMarkdown>
            ) : item.pending ? (
              <TypingDots />
            ) : null}

            {item.error && <div className="msg-error">{item.error}</div>}

            {item.notice && <div className="msg-warn">{item.notice}</div>}

            {item.lowConfidence && (
              <div className="msg-warn">
                Low retrieval confidence — the sources may not fully answer this question.
              </div>
            )}

            {citations.length > 0 && (
              <div className="sources">
                <button
                  type="button"
                  className="sources-toggle"
                  onClick={() => setOpenSources((open) => !open)}
                  aria-expanded={openSources}
                >
                  <span className={`caret ${openSources ? 'open' : ''}`}>▸</span>
                  {openSources ? 'Hide sources' : `Show ${citations.length} sources`}
                </button>

                {openSources && (
                  <ol className="source-list">
                    {citations.map((hit, i) => (
                      <li
                        key={hit.chunk.id}
                        id={`source-${item.id}-${i + 1}`}
                        className={`source ${activeSource === i + 1 ? 'active' : ''}`}
                      >
                        <div className="source-head">
                          <span className="source-index">{i + 1}</span>
                          <span className="source-title">{hit.chunk.docTitle}</span>
                          <span className="source-loc">
                            {hit.chunk.page ? `p.${hit.chunk.page}` : ''}
                            {hit.chunk.section ? ` · ${hit.chunk.section}` : ''}
                          </span>
                        </div>
                        <p className="source-text">{hit.chunk.text}</p>
                        <div className="source-scores">
                          <span title="Cosine similarity">dense {hit.denseScore.toFixed(3)}</span>
                          <span title="BM25 lexical score">bm25 {hit.bm25Score.toFixed(2)}</span>
                          <span title="Reciprocal rank fusion score">
                            rrf {hit.fusedScore.toFixed(4)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            {item.meta && <div className="msg-meta">{item.meta}</div>}

            {item.content && !item.pending && (
              <div className="msg-actions">
                <button type="button" className="msg-action" onClick={copyAnswer}>
                  {copied ? 'Copied ✓' : 'Copy answer'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}
