import { useState } from 'react';
import type { DocSummary } from '../lib/types';
import { DropZone } from './DropZone';

interface Props {
  docs: DocSummary[];
  busy: boolean;
  onRemove: (docId: string) => void;
  onBrowse: () => void;
}

function formatSize(chars: number): string {
  if (chars >= 1000) return `${Math.round(chars / 1000)}k chars`;
  return `${chars} chars`;
}

export function DocumentsPanel({ docs, busy, onRemove, onBrowse }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <section className="panel">
      <header className="panel-head">
        <h2 className="panel-title">Documents</h2>
        <span className="panel-count">
          {docs.length === 0 ? 'empty' : `${docs.length} indexed`}
        </span>
      </header>

      <DropZone onBrowse={onBrowse} busy={busy} />

      {docs.length === 0 ? (
        <p className="panel-empty">
          Nothing indexed yet. Add a PDF, markdown or text file — it never leaves this device.
        </p>
      ) : (
        <ul className="doc-list">
          {docs.map((doc) => (
            <li key={doc.docId} className="doc">
              {confirming === doc.docId ? (
                <div className="doc-confirm">
                  <span className="doc-confirm-text">Remove “{doc.title}”?</span>
                  <div className="doc-confirm-actions">
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => {
                        onRemove(doc.docId);
                        setConfirming(null);
                      }}
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="doc-main">
                    <span className="doc-title" title={doc.sourceName}>
                      {doc.title}
                    </span>
                    <span className="doc-meta">
                      {doc.chunkCount} chunks · {formatSize(doc.chars)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="doc-remove"
                    onClick={() => setConfirming(doc.docId)}
                    title={`Remove ${doc.title}`}
                    aria-label={`Remove ${doc.title}`}
                  >
                    ×
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
