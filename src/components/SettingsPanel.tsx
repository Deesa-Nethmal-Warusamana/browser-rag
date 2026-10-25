import { useState } from 'react';
import type { Settings } from '../hooks/useSettings';
import type { LocalModelState } from '../hooks/useChat';
import { API_PRESETS, LOCAL_MODELS } from '../llm/models';

interface Props {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  local: LocalModelState;
  hasWebGPU: boolean;
  hasDocs: boolean;
  backend: string;
  chunks: number;
  onLoadLocal: () => void;
  onClearIndex: () => void;
}

export function SettingsPanel({
  settings,
  update,
  local,
  hasWebGPU,
  hasDocs,
  backend,
  chunks,
  onLoadLocal,
  onClearIndex,
}: Props) {
  const model = LOCAL_MODELS.find((option) => option.id === settings.localModel) ?? LOCAL_MODELS[0];
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <section className="panel">
      <header className="panel-head">
        <h2 className="panel-title">Setup</h2>
      </header>

      <div className="segmented" role="tablist" aria-label="Generation provider">
        <button
          type="button"
          role="tab"
          aria-selected={settings.provider === 'local'}
          className={settings.provider === 'local' ? 'active' : ''}
          onClick={() => update({ provider: 'local' })}
        >
          On-device
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

      {settings.provider === 'local' ? (
        <div className="stack">
          <label className="field">
            <span className="field-label">Local model</span>
            <select
              className="input"
              value={settings.localModel}
              onChange={(event) => update({ localModel: event.target.value })}
            >
              {LOCAL_MODELS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} · {option.size}
                </option>
              ))}
            </select>
            <span className="field-hint">{model.note}</span>
          </label>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={onLoadLocal}
            disabled={local.status === 'loading' || !hasWebGPU}
          >
            {local.status === 'ready'
              ? 'Model loaded ✓'
              : local.status === 'loading'
                ? 'Downloading…'
                : 'Download & load model'}
          </button>

          {!hasWebGPU && (
            <p className="note warn">
              WebGPU is unavailable in this browser. Use Chrome/Edge for the on-device model, or
              switch to the API provider.
            </p>
          )}

          {local.status === 'loading' && (
            <div className="progress" aria-hidden>
              <div className="progress-bar" style={{ width: `${Math.round((local.pct ?? 0) * 100)}%` }} />
            </div>
          )}

          {local.status !== 'idle' && <p className="note">{local.text}</p>}
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
