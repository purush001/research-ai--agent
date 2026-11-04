import { useState } from 'react';
import { api, describeError } from '../api.js';
import { ErrorBanner, Spinner } from './Common.jsx';

function KeyField({ id, label, configured, value, onChange, placeholder, error, note }) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {configured && <span className="badge badge-ok">Connected</span>}
      </label>
      <input
        id={id}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={configured ? '•••••••••••••••• (saved on the server — paste a new key to replace)' : placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore="true"
        data-lpignore="true"
        aria-invalid={!!error}
      />
      {error && <div className="field-error">{error.message} {error.hint}</div>}
      {note && !error && <div className="muted">{note}</div>}
    </div>
  );
}

export default function Settings({ session, onSessionChange }) {
  const [openaiKey, setOpenaiKey] = useState('');
  const [serpapiKey, setSerpapiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [notes, setNotes] = useState({});
  const [fatal, setFatal] = useState(null);
  const ready = session?.configured.openai && session?.configured.serpapi;
  const [open, setOpen] = useState(!ready);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setNotes({});
    setFatal(null);
    try {
      const res = await api.saveKeys({ openaiKey: openaiKey.trim(), serpapiKey: serpapiKey.trim() });
      setErrors(res.errors || {});
      const n = {};
      if (res.result?.openai) {
        n.openai = res.result.openai.modelAvailable
          ? `Key verified. All three agents use ${res.model}.`
          : `Key verified, but it can't see the model "${res.model}". Drafting will fail until your account has access (or the server's OPENAI_MODEL is changed).`;
      }
      if (res.result?.serpapi) {
        n.serpapi = `Key verified${res.result.serpapi.searchesLeft != null ? ` (${res.result.serpapi.searchesLeft} searches left this period)` : ''}.`;
      }
      setNotes(n);
      // Drop typed secrets from component state as soon as they were sent.
      if (res.result?.openai) setOpenaiKey('');
      if (res.result?.serpapi) setSerpapiKey('');
      onSessionChange({ model: res.model, configured: res.configured });
      if (res.configured.openai && res.configured.serpapi && !Object.keys(res.errors || {}).length) setOpen(false);
    } catch (err) {
      setFatal(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      onSessionChange(await api.clearKeys());
      setOpenaiKey('');
      setSerpapiKey('');
      setNotes({});
      setErrors({});
      setOpen(true);
    } catch (err) {
      setFatal(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="settings-h" id="settings">
      <div className="card-head">
        <h2 id="settings-h">1 · API keys</h2>
        <div className="head-right">
          <span className={`badge ${session?.configured.openai ? 'badge-ok' : 'badge-warn'}`}>OpenAI {session?.configured.openai ? '✓' : 'needed'}</span>
          <span className={`badge ${session?.configured.serpapi ? 'badge-ok' : 'badge-warn'}`}>SerpAPI {session?.configured.serpapi ? '✓' : 'needed'}</span>
          {ready && (
            <button className="btn btn-ghost btn-small" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? 'Hide' : 'Edit'}
            </button>
          )}
        </div>
      </div>
      {open && (
        <form onSubmit={save} autoComplete="off">
          <div className="grid-2">
            <KeyField id="openai-key" label="OpenAI API key" configured={session?.configured.openai} value={openaiKey} onChange={setOpenaiKey} placeholder="sk-…" error={errors.openai} note={notes.openai} />
            <KeyField id="serpapi-key" label="SerpAPI key" configured={session?.configured.serpapi} value={serpapiKey} onChange={setSerpapiKey} placeholder="Your SerpAPI key" error={errors.serpapi} note={notes.serpapi} />
          </div>
          <p className="muted small">
            Keys are verified, then kept only in the local server's memory. They are not written to disk, logs, the page's storage or the build, and are forgotten when the server restarts or you press <em>Clear keys</em>.
          </p>
          <ErrorBanner error={fatal} onDismiss={() => setFatal(null)} />
          <div className="row">
            <button className="btn btn-primary" disabled={busy || (!openaiKey.trim() && !serpapiKey.trim())}>
              {busy ? <Spinner label="Verifying…" /> : 'Verify & save keys'}
            </button>
            {(session?.configured.openai || session?.configured.serpapi) && (
              <button type="button" className="btn" onClick={clear} disabled={busy}>
                Clear keys
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
