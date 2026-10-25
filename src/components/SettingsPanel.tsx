import { useState } from 'react';
import type { Settings } from '../hooks/useSettings';
import type { BuiltInState } from '../hooks/useChat';
import { API_PRESETS } from '../llm/models';

interface Props {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  builtin: BuiltInState;
  hasDocs: boolean;
  backend: string;
  chunks: number;
  onEnableBuiltIn: () => void;
  onRefreshBuiltIn: () => void;
  onClearIndex: () => void;
}

const BUILT_IN_COPY: Record<
  BuiltInState['status'],
  { label: string; tone: 'ok' | 'wait' | 'bad' | 'idle'; body: string }
> = {
  checking: {
    label: 'Checking…',
    tone: 'idle',
    body: 'Looking for the built-in model in this browser.',
  },
  available: {
    label: 'Ready',
    tone: 'ok',
    body: 'Gemini Nano runs inside Chrome. No download for this app to manage, no API key, no bundle.',
  },
  downloadable: {
    label: 'Needs setup',
    tone: 'wait',
    body: 'Chrome can fetch Gemini Nano (roughly 2 GB, managed by Chrome). Enable it once and every site on this device can use it.',
  },
  downloading: {
    label: 'Downloading…',
    tone: 'wait',
    body: 'Chrome is fetching the model. Keep this tab open; you can keep working once it reports ready.',
  },
  unavailable: {
    label: 'Unavailable',
    tone: 'bad',
    body: 'Chrome has the API but the model cannot run here — it needs a supported GPU and about 22 GB of free disk. Use the API provider instead.',
  },
  unsupported: {
    label: 'Not supported',
    tone: 'bad',
    body: 'This browser does not expose the built-in AI API. Use Chrome 138+ on desktop, or switch to the API provider.',
  },
};

export function SettingsPanel({
  settings,
  update,
  builtin,
  hasDocs,
  backend,
  chunks,
  onEnableBuiltIn,
  onRefreshBuiltIn,
  onClearIndex,
}: Props) {
  const [confirmClear, setConfirmClear] = useState(false);
  const copy = BUILT_IN_COPY[builtin.status];

  return (
    <section className="panel">
      <header className="panel-head">
        <h2 className="panel-title">Setup</h2>
      </header>

      <div className="segmented" role="tablist" aria-label="Generation provider">
        <button
          type="button"
          role="tab"
          aria-selected={settings.provider === 'builtin'}
          className={settings.provider === 'builtin' ? 'active' : ''}
          onClick={() => update({ provider: 'builtin' })}
        >
          Built-in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={settings.provider === 'api'}
          className={settings.provider === 'api' ? 'active' : ''}
          onClick={() => update({ provider: 'api' })}
        >
          API key
        </button>
      </div>

      {settings.provider === 'builtin' ? (
        <div className="builtin-card">
          <div className="builtin-head">
            <span className={`dot ${copy.tone}`} aria-hidden />
            <strong>{copy.label}</strong>
            <button type="button" className="link-btn" onClick={onRefreshBuiltIn}>
              Recheck
            </button>
          </div>

          <p className="note">{copy.body}</p>

          {builtin.status === 'downloading' && (
            <div className="progress" aria-hidden>
              <div
                className="progress-bar"
                style={{ width: `${Math.max(3, Math.round((builtin.pct ?? 0) * 100))}%` }}
              />
            </div>
          )}

          {builtin.status === 'downloadable' && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onEnableBuiltIn}>
              Enable built-in model
            </button>
          )}

          {builtin.detail && <p className="note warn">{builtin.detail}</p>}
        </div>
      ) : (
        <div className="stack">
          <label className="field">
            <span className="field-label">Provider preset</span>
            <select
              className="input"
              value={API_PRESETS.find((p) => p.baseUrl === settings.baseUrl)?.id ?? 'custom'}
              onChange={(event) => {
                const preset = API_PRESETS.find((p) => p.id === event.target.value);
                if (preset) update({ baseUrl: preset.baseUrl, model: preset.model });
              }}
            >
              {API_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>

          <label className="field">
            <span className="field-label">Base URL</span>
            <input
              className="input"
              value={settings.baseUrl}
              spellCheck={false}
              onChange={(event) => update({ baseUrl: event.target.value })}
            />
          </label>

          <label className="field">
            <span className="field-label">Model</span>
            <input
              className="input"
              value={settings.model}
              spellCheck={false}
              onChange={(event) => update({ model: event.target.value })}
            />
          </label>

          <label className="field">
            <span className="field-label">API key</span>
            <input
              className="input"
              type="password"
              placeholder="sk-…"
              value={settings.apiKey}
              autoComplete="off"
              onChange={(event) => update({ apiKey: event.target.value })}
            />
            <span className="field-hint">
              Sent directly from your browser to the provider. Nothing is proxied through a server.
            </span>
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.rememberKey}
              onChange={(event) => update({ rememberKey: event.target.checked })}
            />
            <span>Remember key on this device (localStorage)</span>
          </label>

          <p className="note">
            Keys kept in session storage disappear when the tab closes. Only enable “remember” on a
            machine you trust.
          </p>
        </div>
      )}

      <hr className="divider" />

      <div className="stack">
        <label className="field">
          <span className="field-label">
            Passages per question · <strong>{settings.topK}</strong>
          </span>
          <input
            type="range"
            min={3}
            max={12}
            step={1}
            value={settings.topK}
            onChange={(event) => update({ topK: Number(event.target.value) })}
          />
          <span className="field-hint">
            More passages means better recall but more context for the model to sift.
          </span>
        </label>
      </div>

      <hr className="divider" />

      <div className="engine">
        <div className="engine-row">
          <span>Embeddings</span>
          <strong>bge-small-en-v1.5</strong>
        </div>
        <div className="engine-row">
          <span>Runtime</span>
          <strong>{backend || 'starting'}</strong>
        </div>
        <div className="engine-row">
          <span>Indexed</span>
          <strong>{chunks} chunks</strong>
        </div>
      </div>

      <div className="danger-zone">
        <div className="danger-text">
          <strong>Delete local index</strong>
          <span>Removes every document and its vectors from this browser.</span>
        </div>
        {confirmClear ? (
          <div className="danger-actions">
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                onClearIndex();
                setConfirmClear(false);
              }}
            >
              Delete everything
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirmClear(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => setConfirmClear(true)}
            disabled={!hasDocs}
          >
            Delete…
          </button>
        )}
      </div>
    </section>
  );
}
