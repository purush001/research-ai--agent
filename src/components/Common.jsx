import { useEffect, useState } from 'react';
import { copyText } from '../format.js';

export function ErrorBanner({ error, onDismiss, action }) {
  if (!error) return null;
  return (
    <div className="banner banner-error" role="alert">
      <div>
        <strong>{error.provider ? `${error.provider}: ` : ''}{error.message}</strong>
        {error.hint && <div className="muted">{error.hint}</div>}
        {error.retryAfter ? <div className="muted">Try again in about {error.retryAfter} seconds.</div> : null}
      </div>
      <div className="banner-actions">
        {action}
        {onDismiss && (
          <button className="btn btn-ghost" onClick={onDismiss} aria-label="Dismiss error">
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

export function CopyButton({ text, label = 'Copy', disabled }) {
  const [state, setState] = useState('idle');
  useEffect(() => {
    if (state === 'idle') return undefined;
    const t = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      className="btn btn-small"
      disabled={disabled}
      onClick={async () => setState((await copyText(text)) ? 'done' : 'failed')}
    >
      {state === 'done' ? 'Copied ✓' : state === 'failed' ? 'Copy failed' : label}
    </button>
  );
}

export function Spinner({ label }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Seconds since `active` became true; used to show that a long model call is still running. */
export function useElapsed(active) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!active) {
      setS(0);
      return undefined;
    }
    const start = Date.now();
    const t = setInterval(() => setS(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [active]);
  return s;
}
