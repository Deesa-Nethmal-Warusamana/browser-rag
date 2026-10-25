import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RagClient } from './lib/ragClient';
import { isSupportedFile, parseFile } from './lib/parse';
import type { DocSummary, RagStats } from './lib/types';
import { useSettings } from './hooks/useSettings';
import { useChat } from './hooks/useChat';
import { DocumentsPanel } from './components/DocumentsPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { MessageView } from './components/MessageView';
import { Composer } from './components/Composer';
import { EmptyState } from './components/EmptyState';
import sampleHandbook from '../samples/northwind-handbook.md?raw';

interface StatusLine {
  text: string;
  pct?: number;
}

const ACCEPT =
  '.pdf,.txt,.md,.markdown,.csv,.json,.yaml,.yml,.log,.html,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.rb,.sh,.toml,text/*';

export default function App() {
  const client = useMemo(() => new RagClient(), []);
  const [settings, updateSettings] = useSettings();
  const chat = useChat(client, settings);

  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [stats, setStats] = useState<Pick<RagStats, 'chunks' | 'backend'> | null>(null);
  const [status, setStatus] = useState<StatusLine>({ text: 'Starting embedding worker…' });
  const [ready, setReady] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [tab, setTab] = useState<'docs' | 'setup'>('docs');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const applyStats = useCallback((next: RagStats) => {
    setDocs(next.docs);
    setStats({ chunks: next.chunks, backend: next.backend });
  }, []);

  useEffect(() => {
    const unsubscribe = client.on((event) => {
      if (event.kind === 'status') setStatus({ text: event.text, pct: event.pct });
    });

    client
      .init()
      .then((initial) => {
        applyStats(initial);
        setReady(true);
        setStatus({
          text: initial.chunks
            ? `Ready · ${initial.chunks} chunks on device`
            : 'Ready · add a document to begin',
        });
      })
      .catch((error: unknown) => {
        setFatal(error instanceof Error ? error.message : String(error));
      });

    return () => {
      unsubscribe();
      client.dispose();
    };
  }, [applyStats, client]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.items]);

  const openPicker = useCallback(() => fileInputRef.current?.click(), []);

  const ingestFiles = useCallback(
    async (files: File[]) => {
      setUploading(true);
      try {
        for (const file of files) {
          if (!isSupportedFile(file)) {
            setStatus({ text: `Unsupported file type: ${file.name}` });
            continue;
          }
          try {
            setStatus({ text: `Parsing ${file.name}…` });
            const parsed = await parseFile(file);
            const result = await client.ingest(parsed);
            applyStats(result);
            setStatus({ text: `Indexed ${parsed.title} · ${result.chunks} chunks total` });
          } catch (error) {
            setStatus({
              text: `${file.name}: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }
      } finally {
        setUploading(false);
        // On narrow screens the drawer covers the chat, so get out of the way.
        if (window.matchMedia('(max-width: 900px)').matches) setSidebarOpen(false);
        composerRef.current?.focus();
      }
    },
    [applyStats, client],
  );

  // Accept a drop anywhere on the page, not just on the drop zone.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      void ingestFiles([...event.dataTransfer.files]);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [ingestFiles]);

  // Escape closes the drawer.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const loadSample = useCallback(async () => {
    const file = new File([sampleHandbook], 'northwind-handbook.md', { type: 'text/markdown' });
    await ingestFiles([file]);
  }, [ingestFiles]);

  const removeDoc = useCallback(
    async (docId: string) => {
      const next = await client.removeDoc(docId);
      applyStats(next);
      setStatus({ text: 'Document removed from the index' });
    },
    [applyStats, client],
  );

  const clearIndex = useCallback(async () => {
    const next = await client.clear();
    applyStats(next);
    setStatus({ text: 'Index cleared' });
  }, [applyStats, client]);

  const providerLabel =
    settings.provider === 'api'
      ? `${settings.model || 'API model'} · frontier`
      : chat.builtin.status === 'available'
        ? 'Gemini Nano · built-in'
        : 'Built-in model · not ready';

  const suggestions = useMemo(() => {
    const first = docs[0]?.title;
    if (!first) return [];
    return [
      `Summarise the key points of "${first}".`,
      `What are the most important steps described in "${first}"?`,
      `List the concrete numbers, dates or limits mentioned in "${first}".`,
    ];
  }, [docs]);

  const statusLabel = !ready
    ? typeof status.pct === 'number'
      ? `Preparing ${Math.round(status.pct * 100)}%`
      : 'Preparing…'
    : uploading
      ? 'Indexing…'
      : 'Index ready';

  if (fatal) {
    return (
      <div className="fatal">
        <h1>The index could not start</h1>
        <p>{fatal}</p>
        <p className="note">
          This app needs Web Workers and IndexedDB. It also needs a secure context
          (<code>localhost</code> or HTTPS) for <code>crypto.subtle</code> and model downloads.
        </p>
      </div>
    );
  }

  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        accept={ACCEPT}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          if (files.length) void ingestFiles(files);
          event.target.value = '';
        }}
      />

      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className="sidebar" aria-label="Documents and settings">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <span />
            <span />
          </span>
          <div className="brand-text">
            <span className="brand-title">Browser RAG</span>
            <span className="brand-sub">retrieval that never leaves your device</span>
          </div>
        </div>

        <button
          type="button"
          className="icon-btn sidebar-close"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close panel"
        >
          ×
        </button>

        <div className="stats-row">
          <div className="stat">
            <span className="stat-value">{stats?.chunks ?? 0}</span>
            <span className="stat-label">chunks</span>
          </div>
          <div className="stat">
            <span className="stat-value">{docs.length}</span>
            <span className="stat-label">docs</span>
          </div>
          <div className="stat">
            <span className="stat-value">{stats?.backend ?? '—'}</span>
            <span className="stat-label">runtime</span>
          </div>
        </div>

        <div className="statusline" role="status" aria-live="polite">
          <div className="statusline-text">{status.text}</div>
          {typeof status.pct === 'number' && (
            <div className="progress">
              <div
                className="progress-bar"
                style={{ width: `${Math.max(2, Math.round(status.pct * 100))}%` }}
              />
            </div>
          )}
        </div>

        <nav className="tabs" aria-label="Sidebar sections">
          <button
            type="button"
            className={`tab ${tab === 'docs' ? 'active' : ''}`}
            onClick={() => setTab('docs')}
            aria-current={tab === 'docs' ? 'page' : undefined}
          >
            Documents
            {docs.length > 0 && <span className="tab-count">{docs.length}</span>}
          </button>
          <button
            type="button"
            className={`tab ${tab === 'setup' ? 'active' : ''}`}
            onClick={() => setTab('setup')}
            aria-current={tab === 'setup' ? 'page' : undefined}
          >
            Setup
          </button>
        </nav>

        {tab === 'docs' ? (
          <DocumentsPanel
            docs={docs}
            busy={uploading}
            onRemove={removeDoc}
            onBrowse={openPicker}
          />
        ) : (
          <SettingsPanel
            settings={settings}
            update={updateSettings}
            builtin={chat.builtin}
            hasDocs={docs.length > 0}
            backend={stats?.backend ?? ''}
            chunks={stats?.chunks ?? 0}
            onEnableBuiltIn={chat.enableBuiltIn}
            onRefreshBuiltIn={chat.refreshBuiltIn}
            onClearIndex={clearIndex}
          />
        )}

        <footer className="about">
          <p>
            Retrieval runs locally: <code>bge-small-en-v1.5</code> via Transformers.js, dense +
            BM25 fused with RRF, stored in IndexedDB.
          </p>
          <p className="note">
            With the API provider, only your question and the retrieved passages are sent to that
            provider.
          </p>
        </footer>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="btn btn-ghost btn-sm sidebar-toggle"
              onClick={() => setSidebarOpen(true)}
            >
              <span aria-hidden="true">☰</span> Library
            </button>
            <span className={`pill ${ready ? 'pill-ok' : 'pill-wait'}`}>
              <span className="pill-dot" />
              {statusLabel}
            </span>
          </div>
          <div className="topbar-right">
            {chat.items.length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={chat.clear}>
                New chat
              </button>
            )}
            <span className="pill pill-quiet">{providerLabel}</span>
          </div>
        </header>

        {typeof status.pct === 'number' && !ready && (
          <div className="topbar-progress" aria-hidden="true">
            <div
              className="topbar-progress-bar"
              style={{ width: `${Math.max(2, Math.round(status.pct * 100))}%` }}
            />
          </div>
        )}

        <div className="chat-scroll">
          <div className="chat">
            {chat.items.length === 0 ? (
              <EmptyState
                hasDocuments={docs.length > 0}
                ready={ready}
                busy={uploading}
                suggestions={suggestions}
                onBrowse={openPicker}
                onLoadSample={() => void loadSample()}
                onAsk={(question) => void chat.send(question)}
              />
            ) : (
              chat.items.map((item) => <MessageView key={item.id} item={item} />)
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <Composer
          busy={chat.busy}
          disabled={!ready}
          providerLabel={providerLabel}
          inputRef={composerRef}
          placeholder={
            ready
              ? docs.length > 0
                ? 'Ask a question about your documents…'
                : 'Add a document first, then ask…'
              : 'Loading the embedding model…'
          }
          onSend={(text) => void chat.send(text)}
          onStop={chat.stop}
        />
      </main>

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card">
            <span className="drop-overlay-icon">⇪</span>
            <strong>Drop to index</strong>
            <span>Parsed and embedded on this device</span>
          </div>
        </div>
      )}
    </div>
  );
}
