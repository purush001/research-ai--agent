const KEYS = { openai: 'aca.openaiKey', serp: 'aca.serpKey', remember: 'aca.remember', model: 'aca.model' };
export const DEFAULT_MODEL = import.meta.env.VITE_OPENAI_MODEL || 'gpt-6.1-sol';

const safe = (fn, fallback = '') => {
  try { return fn() ?? fallback; } catch { return fallback; }
};

export function loadSettings() {
  const remember = safe(() => localStorage.getItem(KEYS.remember)) === '1';
  const store = remember ? localStorage : sessionStorage;
  return {
    openaiKey: safe(() => store.getItem(KEYS.openai)),
    serpKey: safe(() => store.getItem(KEYS.serp)),
    model: safe(() => localStorage.getItem(KEYS.model)) || DEFAULT_MODEL,
    remember,
  };
}

export function saveSettings({ openaiKey, serpKey, model, remember }) {
  safe(() => {
    for (const s of [localStorage, sessionStorage]) {
      s.removeItem(KEYS.openai);
      s.removeItem(KEYS.serp);
    }
    const store = remember ? localStorage : sessionStorage;
    store.setItem(KEYS.openai, openaiKey);
    store.setItem(KEYS.serp, serpKey);
    localStorage.setItem(KEYS.remember, remember ? '1' : '0');
    localStorage.setItem(KEYS.model, model || DEFAULT_MODEL);
  });
}

export const hasKeys = (s) => Boolean(s.openaiKey && s.serpKey);
