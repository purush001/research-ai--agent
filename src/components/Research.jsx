import { useState } from 'react';
import { CATEGORIES, CATEGORY_META, fmtDateTime, fmtSpan } from '../format.js';
import { ErrorBanner, Spinner, useElapsed } from './Common.jsx';

const WIDEN_OPTIONS = [
  { hours: 48, label: 'Past 48 hours' },
  { hours: 72, label: 'Past 3 days' },
  { hours: 168, label: 'Past 7 days' },
  { hours: 336, label: 'Past 14 days' },
  { hours: 720, label: 'Past 30 days' },
];

export function WindowLine({ window }) {
  if (!window) return null;
  return (
    <p className="window-line">
      <strong>Search window:</strong> {fmtDateTime(window.start)} → {fmtDateTime(window.end)}{' '}
      <span className="muted">({fmtSpan(window.start, window.end)}, your local time)</span>
      {window.clamped && <span className="badge badge-warn">Limited to the last {window.maxDays} days</span>}
    </p>
  );
}

export default function ResearchPanel({ ready, mode, onMode, lastRun, previewWindow, usedFallback, running, onRun, error, onDismissError, research, locked }) {
  const elapsed = useElapsed(running);
  return (
    <section className="card" aria-labelledby="research-h">
      <div className="card-head">
        <h2 id="research-h">2 · Research Agent</h2>
      </div>
      <fieldset className="radios" disabled={running || locked}>
        <legend className="sr-only">Search window</legend>
        <label className={`radio ${mode === 'past24h' ? 'on' : ''}`}>
          <input type="radio" name="mode" checked={mode === 'past24h'} onChange={() => onMode('past24h')} />
          <span>
            <strong>Past 24 hours</strong>
            <small>Always available; used on the first run.</small>
          </span>
        </label>
        <label className={`radio ${mode === 'sinceLast' ? 'on' : ''}`}>
          <input type="radio" name="mode" checked={mode === 'sinceLast'} onChange={() => onMode('sinceLast')} />
          <span>
            <strong>Since last successful run</strong>
            <small>{lastRun ? `Last success: ${fmtDateTime(lastRun)}` : 'No successful run yet — the first run will use the past 24 hours.'}</small>
          </span>
        </label>
      </fieldset>
      {!research && <WindowLine window={previewWindow} />}
      {usedFallback && !research && <p className="muted small">No earlier run was found, so this run falls back to the past 24 hours.</p>}
      <div className="row">
        <button className="btn btn-primary" onClick={onRun} disabled={!ready || running || locked}>
          {running ? <Spinner label={`Researching… ${elapsed}s`} /> : research ? 'Run research again' : 'Run research'}
        </button>
        {!ready && <span className="muted">Add both API keys first.</span>}
        {locked && <span className="muted">Drafts exist — reset them to run research again.</span>}
      </div>
      {running && <p className="muted small">Searching Oracle, PeopleSoft and general AI news, checking publication dates, then asking the model to shape ideas. This usually takes under a minute.</p>}
      <ErrorBanner error={error} onDismiss={onDismissError} />
      {research?.window && <WindowLine window={research.window} />}
      {research?.warnings?.map((w) => (
        <div key={w} className="banner banner-warn">{w}</div>
      ))}
      {research?.stats && (
        <p className="muted small">
          {research.stats.found} articles found · {research.stats.inWindow} inside the window with a verified date
          {research.stats.undated ? ` · ${research.stats.undated} ignored (no date)` : ''}
          {research.stats.outsideWindow ? ` · ${research.stats.outsideWindow} ignored (outside window)` : ''}.
        </p>
      )}
    </section>
  );
}

export function Shortfall({ missing, widening, onWiden, disabled }) {
  const total = CATEGORIES.reduce((n, c) => n + (missing[c] || 0), 0);
  const [hours, setHours] = useState(168);
  const elapsed = useElapsed(widening);
  if (!total) return null;
  return (
    <div className="banner banner-warn shortfall" role="status">
      <div>
        <strong>{total} {total === 1 ? 'idea is' : 'ideas are'} missing.</strong>{' '}
        {CATEGORIES.filter((c) => missing[c]).map((c) => `${CATEGORY_META[c].label}: ${missing[c]} short`).join(' · ')}
        <div className="muted">Widen the search window to look further back for the missing categories only. Ideas you already have are kept.</div>
      </div>
      <div className="row nowrap">
        <label className="sr-only" htmlFor="widen">Widen search to</label>
        <select id="widen" value={hours} onChange={(e) => setHours(Number(e.target.value))} disabled={widening || disabled}>
          {WIDEN_OPTIONS.map((o) => (
            <option key={o.hours} value={o.hours}>{o.label}</option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={() => onWiden(hours)} disabled={widening || disabled}>
          {widening ? <Spinner label={`Searching… ${elapsed}s`} /> : 'Widen search'}
        </button>
      </div>
    </div>
  );
}
