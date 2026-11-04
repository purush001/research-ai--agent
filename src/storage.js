// Only non-sensitive state is persisted in the browser: the end timestamp of
// the last successful research run. API keys are never written here.

const KEY = 'ai-content-agents:lastSuccessfulRun';

export function loadLastRun() {
  try {
    const v = localStorage.getItem(KEY);
    return v && !Number.isNaN(Date.parse(v)) ? v : null;
  } catch {
    return null;
  }
}

export function saveLastRun(iso) {
  try {
    localStorage.setItem(KEY, iso);
  } catch {
    /* storage unavailable (private mode): the next run just falls back to 24 hours */
  }
}
