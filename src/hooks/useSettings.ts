import { useCallback, useEffect, useState } from 'react';

export interface Settings {
  provider: 'local' | 'api';
  apiKey: string;
  baseUrl: string;
  model: string;
  rememberKey: boolean;
  localModel: string;
  topK: number;
}

const SETTINGS_KEY = 'browser-rag:settings:v1';
const KEY_SLOT = 'browser-rag:api-key';

export const DEFAULT_SETTINGS: Settings = {
  provider: 'local',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  rememberKey: false,
  localModel: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  topK: 6,
};

function readSettings(): Settings {
  let stored: Partial<Settings> = {};
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) stored = JSON.parse(raw) as Partial<Settings>;
  } catch {
    /* corrupted settings — start fresh */
  }

  let apiKey = '';
  try {
    apiKey =
      (stored.rememberKey ? localStorage.getItem(KEY_SLOT) : null) ??
      sessionStorage.getItem(KEY_SLOT) ??
      '';
  } catch {
    /* storage disabled */
  }

  return { ...DEFAULT_SETTINGS, ...stored, apiKey };
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
