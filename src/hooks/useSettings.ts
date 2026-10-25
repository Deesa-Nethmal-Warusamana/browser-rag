import { useCallback, useEffect, useState } from 'react';

export interface Settings {
  provider: 'builtin' | 'api';
  apiKey: string;
  baseUrl: string;
  model: string;
  rememberKey: boolean;
  topK: number;
}

const SETTINGS_KEY = 'browser-rag:settings:v1';
const KEY_SLOT = 'browser-rag:api-key';

export const DEFAULT_SETTINGS: Settings = {
  provider: 'builtin',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  rememberKey: false,
  topK: 6,
};

function readSettings(): Settings {
  let stored: Record<string, unknown> = {};
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) stored = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* corrupted settings — start fresh */
  }

  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    // Older builds stored 'local' for the WebLLM provider; treat it as built-in.
    provider: stored.provider === 'api' ? 'api' : 'builtin',
    baseUrl: typeof stored.baseUrl === 'string' ? stored.baseUrl : DEFAULT_SETTINGS.baseUrl,
    model: typeof stored.model === 'string' ? stored.model : DEFAULT_SETTINGS.model,
    rememberKey: stored.rememberKey === true,
    topK: typeof stored.topK === 'number' ? stored.topK : DEFAULT_SETTINGS.topK,
  };

  try {
    settings.apiKey =
      (settings.rememberKey ? localStorage.getItem(KEY_SLOT) : null) ??
      sessionStorage.getItem(KEY_SLOT) ??
      '';
  } catch {
    /* storage disabled */
  }

  return settings;
}

function persistSettings(settings: Settings) {
  try {
    const { apiKey, ...rest } = settings;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));

    if (apiKey) {
      sessionStorage.setItem(KEY_SLOT, apiKey);
      if (settings.rememberKey) localStorage.setItem(KEY_SLOT, apiKey);
      else localStorage.removeItem(KEY_SLOT);
    } else {
      sessionStorage.removeItem(KEY_SLOT);
      localStorage.removeItem(KEY_SLOT);
    }
  } catch {
    /* storage disabled — settings stay in memory */
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(readSettings);

  useEffect(() => {
    persistSettings(settings);
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  return [settings, update] as const;
}
