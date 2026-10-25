export interface LocalModelOption {
  id: string;
  label: string;
  size: string;
  note: string;
}

export const LOCAL_MODELS: LocalModelOption[] = [
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B Instruct',
    size: '~0.7 GB',
    note: 'Fastest to load, good enough for simple lookups',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 1.5B Instruct',
    size: '~1.0 GB',
    note: 'Best small-model reasoning per byte',
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 3B Instruct',
    size: '~1.9 GB',
    note: 'Best quality, needs ~4 GB of free VRAM',
  },
];

export interface ApiPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
}

export const API_PRESETS: ApiPreset[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' },
];

export const HARD_CONTEXT_CHARS = 12_000;
