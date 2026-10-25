interface Props {
  hasDocuments: boolean;
  ready: boolean;
  busy: boolean;
  suggestions: string[];
  onBrowse: () => void;
  onLoadSample: () => void;
  onAsk: (question: string) => void;
}

export function EmptyState({
  hasDocuments,
  ready,
  busy,
  suggestions,
  onBrowse,
  onLoadSample,
  onAsk,
}: Props) {
  return (
    <div className="empty">
      <h1 className="empty-title">
        Ask your documents.
        <br />
        <span className="gradient">Nothing leaves this tab.</span>
      </h1>
      <p className="empty-sub">
        Documents are chunked, embedded and searched on your device. Every answer cites the exact
        passage it came from — click a numbered chip to jump to it.
      </p>

      {hasDocuments ? (
        <>
          <p className="empty-hint">Ready. Try one of these:</p>
          <div className="suggestions">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="suggestion"
                onClick={() => onAsk(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <button type="button" className="empty-drop" onClick={onBrowse} disabled={!ready}>
            <span className="empty-drop-icon" aria-hidden>
              ⇪
            </span>
            <span className="empty-drop-title">Add your first document</span>
            <span className="empty-drop-hint">
              Drop it anywhere on this page, or click to choose a file
            </span>
          </button>

          <div className="empty-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onLoadSample}
              disabled={!ready || busy}
            >
              {busy ? 'Adding sample…' : 'Or try the sample handbook'}
            </button>
          </div>

          <ol className="steps">
            <li>Add a document</li>
            <li>Ask a question</li>
            <li>Open a citation to check the source</li>
          </ol>
        </>
      )}
    </div>
  );
}
