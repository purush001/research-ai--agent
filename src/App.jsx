import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, describeError } from './api.js';
import { loadLastRun, saveLastRun } from './storage.js';
import Settings from './components/Settings.jsx';
import ResearchPanel, { Shortfall } from './components/Research.jsx';
import Ideas from './components/Ideas.jsx';
import Approval, { DEFAULT_TWEETS } from './components/Approval.jsx';
import { LinkedInSection, XSection } from './components/Drafts.jsx';
import { ErrorBanner } from './components/Common.jsx';

const DAY_MS = 24 * 3_600_000;

function computeStart(mode, lastRun, now = Date.now()) {
  if (mode === 'sinceLast' && lastRun) return { start: new Date(lastRun), fallback: false };
  return { start: new Date(now - DAY_MS), fallback: mode === 'sinceLast' };
}

const emptyAgent = () => ({ error: null, items: {} });

export default function App() {
  const [session, setSession] = useState(null);
  const [bootError, setBootError] = useState(null);

  const [lastRun, setLastRun] = useState(loadLastRun);
  const [mode, setMode] = useState('past24h');
  const [research, setResearch] = useState(null); // { ideas, window, missing, warnings, stats }
  const [running, setRunning] = useState(false);
  const [widening, setWidening] = useState(false);
  const [researchError, setResearchError] = useState(null);

  const [notes, setNotes] = useState({});
  const [approvedIds, setApprovedIds] = useState([]);
  const [config, setConfig] = useState({}); // per idea: { ctaUrl, tweetCount }
  const [drafting, setDrafting] = useState(null);
  const draftingRef = useRef(null);
  const [nowMs, setNowMs] = useState(Date.now);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    api.getSession().then(setSession, (e) => setBootError(describeError(e)));
  }, []);

  const ready = !!(session?.configured.openai && session?.configured.serpapi);
  const preview = useMemo(() => {
    const { start, fallback } = computeStart(mode, lastRun, nowMs);
    return { window: { start: start.toISOString(), end: new Date(nowMs).toISOString() }, fallback };
  }, [mode, lastRun, nowMs]);

  /* ------------------------------ research ------------------------------ */

  async function runResearch() {
    setRunning(true);
    setResearchError(null);
    const { start } = computeStart(mode, lastRun);
    try {
      const res = await api.research({ windowStart: start.toISOString() });
      setResearch({ ideas: res.ideas, window: res.window, missing: res.missing, warnings: res.warnings, stats: res.searchStats });
      setApprovedIds([]);
      setNotes({});
      // Only a successful run moves the "since last run" marker; failures keep the old one.
      saveLastRun(res.window.end);
      setLastRun(res.window.end);
      setNowMs(Date.now());
    } catch (e) {
      setResearchError(describeError(e));
    } finally {
      setRunning(false);
    }
  }

  async function widen(hours) {
    if (!research) return;
    setWidening(true);
    setResearchError(null);
    const end = research.window.end;
    try {
      const res = await api.research({
        windowStart: new Date(Date.parse(end) - hours * 3_600_000).toISOString(),
        windowEnd: end,
        needs: research.missing,
        existing: research.ideas.map(({ headline, category, sources }) => ({ headline, category, sources })),
      });
      setResearch((r) => ({
        ...r,
        ideas: [...r.ideas, ...res.ideas],
        missing: res.missing,
        window: { ...r.window, start: new Date(Math.min(Date.parse(r.window.start), Date.parse(res.window.start))).toISOString(), clamped: res.window.clamped },
        warnings: res.warnings,
        stats: res.searchStats,
      }));
    } catch (e) {
      setResearchError(describeError(e));
    } finally {
      setWidening(false);
    }
  }

  const toggleApprove = useCallback((id) => {
    setApprovedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length < 3 ? [...ids, id] : ids));
    setConfig((c) => (c[id] ? c : { ...c, [id]: { ctaUrl: '', tweetCount: DEFAULT_TWEETS } }));
  }, []);

  const approvedIdeas = useMemo(() => (research ? approvedIds.map((id) => research.ideas.find((i) => i.id === id)).filter(Boolean) : []), [research, approvedIds]);

  /* ------------------------------ drafting ------------------------------ */

  const patch = (fn) => {
    const next = fn(draftingRef.current);
    draftingRef.current = next;
    setDrafting(next);
  };

  const buildPayload = (platform, d, id) => {
    const idea = d.ideas.find((i) => i.id === id);
    return platform === 'linkedin' ? { ...idea, ctaUrl: d.config[id].ctaUrl.trim() } : { ...idea, tweetCount: d.config[id].tweetCount };
  };

  async function runAgent(platform, ids) {
    if (!ids.length) return;
    const d = draftingRef.current;
    const payload = ids.map((id) => buildPayload(platform, d, id));
    patch((cur) => ({
      ...cur,
      [platform]: {
        error: null,
        items: { ...cur[platform].items, ...Object.fromEntries(ids.map((id) => [id, { ...cur[platform].items[id], status: 'running', error: null }])) },
      },
    }));
    try {
      const res = await (platform === 'linkedin' ? api.linkedin(payload) : api.x(payload));
      const list = platform === 'linkedin' ? res.posts : res.threads;
      patch((cur) => {
        const items = { ...cur[platform].items };
        for (const r of list) {
          items[r.ideaId] = r.ok
            ? { status: 'done', warnings: r.warnings, hookRevised: r.hookRevised, ...(platform === 'linkedin' ? { text: r.text } : { tweets: r.tweets }) }
            : { status: 'error', error: r.error };
        }
        return { ...cur, [platform]: { error: null, items } };
      });
    } catch (e) {
      const error = describeError(e);
      // Drafts that already completed are untouched; only the requested ones fail.
      patch((cur) => ({
        ...cur,
        [platform]: { error, items: { ...cur[platform].items, ...Object.fromEntries(ids.map((id) => [id, { status: 'error', error }])) } },
      }));
    }
  }

  function startDrafting() {
    const ideas = approvedIdeas.map((i) => ({ ...i, notes: (notes[i.id] || '').trim() }));
    const snapshotConfig = Object.fromEntries(ideas.map((i) => [i.id, { ...config[i.id] }]));
    draftingRef.current = { ideas, config: snapshotConfig, linkedin: emptyAgent(), x: emptyAgent() };
    setDrafting(draftingRef.current);
    const ids = ideas.map((i) => i.id);
    // Both agents start at the same moment and run independently.
    runAgent('linkedin', ids);
    runAgent('x', ids);
    setTimeout(() => document.getElementById('drafts-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function resetDrafts() {
    const has = drafting && ['linkedin', 'x'].some((p) => Object.values(drafting[p].items).some((i) => i.status === 'done'));
    if (has && !window.confirm('Discard all drafts and choose ideas again?')) return;
    draftingRef.current = null;
    setDrafting(null);
  }

  const setDraftConfig = (id, change) => patch((cur) => ({ ...cur, config: { ...cur.config, [id]: { ...cur.config[id], ...change } } }));
  const editLinkedIn = (id, text) => patch((cur) => ({ ...cur, linkedin: { ...cur.linkedin, items: { ...cur.linkedin.items, [id]: { ...cur.linkedin.items[id], text } } } }));
  const editTweet = (id, index, text) =>
    patch((cur) => {
      const item = cur.x.items[id];
      return { ...cur, x: { ...cur.x, items: { ...cur.x.items, [id]: { ...item, tweets: item.tweets.map((t, i) => (i === index ? text : t)) } } } };
    });

  const hasDrafts = !!drafting;

  /* -------------------------------- render ------------------------------- */

  return (
    <div className="page">
      <header className="masthead">
        <h1>AI News Research &amp; Social Content</h1>
        <p>Three agents: research recent AI news, then draft LinkedIn posts and X threads for the ideas you approve.</p>
      </header>
      <ErrorBanner error={bootError} />

      <Settings session={session} onSessionChange={setSession} />

      <ResearchPanel
        ready={ready}
        mode={mode}
        onMode={setMode}
        lastRun={lastRun}
        previewWindow={preview.window}
        usedFallback={preview.fallback}
        running={running}
        onRun={runResearch}
        error={researchError}
        onDismissError={() => setResearchError(null)}
        research={research}
        locked={hasDrafts}
      />

      {research && (
        <section className="card" aria-labelledby="ideas-h">
          <div className="card-head"><h2 id="ideas-h">3 · Review &amp; approve</h2></div>
          <Shortfall missing={research.missing} windowEnd={research.window.end} widening={widening} onWiden={widen} disabled={hasDrafts || running} />
          {research.ideas.length === 0 ? (
            <p className="empty">No ideas were found. Widen the window or retry.</p>
          ) : (
            <Ideas ideas={research.ideas} approvedIds={approvedIds} notes={notes} onNote={(id, v) => setNotes((n) => ({ ...n, [id]: v }))} onToggle={toggleApprove} locked={hasDrafts} />
          )}
          {!hasDrafts && approvedIdeas.length === 3 && (
            <Approval ideas={approvedIdeas} config={config} onConfig={(id, ch) => setConfig((c) => ({ ...c, [id]: { ...c[id], ...ch } }))} onStart={startDrafting} />
          )}
          {!hasDrafts && approvedIdeas.length < 3 && research.ideas.length > 0 && (
            <p className="gate muted">Approve {3 - approvedIdeas.length} more {3 - approvedIdeas.length === 1 ? 'idea' : 'ideas'} to continue. Drafting starts only after you confirm.</p>
          )}
          {hasDrafts && (
            <div className="row">
              <span className="muted">Ideas and notes are locked while drafts exist.</span>
              <button className="btn" onClick={resetDrafts}>Discard drafts &amp; choose again</button>
            </div>
          )}
        </section>
      )}

      {drafting && (
        <div id="drafts-top">
          <LinkedInSection drafting={drafting} onRetry={(ids) => runAgent('linkedin', ids)} onRegenerate={(ids) => runAgent('linkedin', ids)} onEdit={editLinkedIn} onConfig={setDraftConfig} />
          <XSection drafting={drafting} onRetry={(ids) => runAgent('x', ids)} onRegenerate={(ids) => runAgent('x', ids)} onEditTweet={editTweet} onConfig={setDraftConfig} />
        </div>
      )}

      <footer className="foot muted small">
        All three agents use <code>{session?.model || 'gpt-6.1-sol'}</code> · Web search by SerpAPI · Drafts are for manual publishing; nothing is posted for you.
      </footer>
    </div>
  );
}
