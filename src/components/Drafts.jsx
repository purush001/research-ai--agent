import { X_LIMIT, validateTweet, xWeightedLength } from '../../shared/xlength.js';
import { CATEGORY_META } from '../format.js';
import { validCount, validUrl, MAX_TWEETS, MIN_TWEETS } from './Approval.jsx';
import { CopyButton, ErrorBanner, Spinner, useElapsed } from './Common.jsx';

const LINKEDIN_LIMIT = 3000;

function agentSummary(agent, ids) {
  const items = ids.map((id) => agent.items[id]);
  const done = items.filter((i) => i?.status === 'done').length;
  const failed = items.filter((i) => i?.status === 'error').length;
  const running = items.filter((i) => i?.status === 'running').length;
  return { done, failed, running, total: ids.length };
}

function AgentHeader({ title, subtitle, agent, ids, onRetryFailed, onRegenerateAll }) {
  const s = agentSummary(agent, ids);
  const elapsed = useElapsed(s.running > 0);
  const pct = Math.round(((s.done + s.failed) / s.total) * 100);
  return (
    <div className="agent-head">
      <div>
        <h3>{title}</h3>
        <p className="muted small">{subtitle}</p>
      </div>
      <div className="agent-status">
        {s.running > 0 ? (
          <Spinner label={`Writing ${s.running} ${s.running === 1 ? 'draft' : 'drafts'}… ${elapsed}s`} />
        ) : s.failed === 0 && s.done === s.total ? (
          <span className="badge badge-ok">All {s.total} drafts ready</span>
        ) : (
          <span className="badge badge-warn">{s.done} ready · {s.failed} failed</span>
        )}
        <div className="progress" aria-hidden="true"><div style={{ width: `${pct}%` }} className={s.failed ? 'bar-warn' : ''} /></div>
        <div className="row nowrap">
          {s.failed > 0 && s.running === 0 && (
            <button className="btn btn-small btn-primary" onClick={onRetryFailed}>Retry {s.failed} failed</button>
          )}
          {s.running === 0 && <button className="btn btn-small" onClick={onRegenerateAll}>Regenerate all</button>}
        </div>
      </div>
    </div>
  );
}

function Warnings({ warnings }) {
  if (!warnings?.length) return null;
  return (
    <ul className="warnings">
      {warnings.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  );
}

function ItemShell({ idea, item, children, extra, onRegenerate, disabled }) {
  return (
    <article className="draft">
      <header className="draft-head">
        <div>
          <span className={`chip chip-${idea.category}`}>{CATEGORY_META[idea.category].label}</span>
          <h4>{idea.headline}</h4>
        </div>
        <div className="row nowrap">
          {extra}
          <button className="btn btn-small" onClick={onRegenerate} disabled={disabled || item?.status === 'running'}>
            {item?.status === 'error' ? 'Retry' : 'Regenerate'}
          </button>
        </div>
      </header>
      {item?.status === 'running' && <p className="skeleton"><Spinner label="Writing and checking the opening…" /></p>}
      {item?.status === 'error' && <ErrorBanner error={item.error} />}
      {item?.status === 'done' && children}
    </article>
  );
}

export function LinkedInSection({ drafting, onRetry, onRegenerate, onEdit, onConfig }) {
  const ids = drafting.ideas.map((i) => i.id);
  const agent = drafting.linkedin;
  return (
    <section className="card" aria-labelledby="li-h">
      <div className="card-head"><h2 id="li-h">4a · LinkedIn posts</h2></div>
      <AgentHeader title="LinkedIn Agent" subtitle="One standalone post per idea for technical professionals with 10–20 years of experience." agent={agent} ids={ids} onRetryFailed={() => onRetry(ids.filter((id) => agent.items[id]?.status === 'error'))} onRegenerateAll={() => onRetry(ids)} />
      <ErrorBanner error={agent.error} />
      {drafting.ideas.map((idea) => {
        const item = agent.items[idea.id];
        const cfg = drafting.config[idea.id];
        const urlBad = !validUrl(cfg.ctaUrl?.trim());
        return (
          <ItemShell key={idea.id} idea={idea} item={item} onRegenerate={() => onRegenerate([idea.id])} disabled={urlBad}>
            <Warnings warnings={item?.warnings} />
            <label className="sr-only" htmlFor={`li-${idea.id}`}>LinkedIn post for {idea.headline}</label>
            <textarea id={`li-${idea.id}`} className="post-text" value={item?.text || ''} onChange={(e) => onEdit(idea.id, e.target.value)} rows={Math.min(28, Math.max(10, (item?.text || '').split('\n').length + 2))} />
            <div className="draft-foot">
              <span className={`counter ${(item?.text || '').length > LINKEDIN_LIMIT ? 'over' : ''}`}>{(item?.text || '').length.toLocaleString()} / {LINKEDIN_LIMIT.toLocaleString()} characters</span>
              <CopyButton text={item?.text || ''} label="Copy post" />
            </div>
          </ItemShell>
        );
      })}
      <div className="cta-edit">
        <h4>CTA links <span className="muted">(applied when you regenerate a post)</span></h4>
        {drafting.ideas.map((idea) => {
          const urlBad = !validUrl(drafting.config[idea.id].ctaUrl?.trim());
          return (
            <div className="field" key={idea.id}>
              <label htmlFor={`cta2-${idea.id}`}>{idea.headline}</label>
              <input id={`cta2-${idea.id}`} type="url" placeholder="No CTA — sources only" value={drafting.config[idea.id].ctaUrl || ''} onChange={(e) => onConfig(idea.id, { ctaUrl: e.target.value })} aria-invalid={urlBad} />
              {urlBad && <div className="field-error">Enter a full http(s) link, or leave blank.</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TweetBox({ index, text, onChange }) {
  const v = validateTweet(text);
  return (
    <li className="tweet">
      <div className="tweet-num">{index + 1}</div>
      <div className="tweet-body">
        <textarea aria-label={`Tweet ${index + 1}`} value={text} onChange={(e) => onChange(e.target.value)} rows={Math.max(3, Math.ceil(text.length / 70) + (text.split('\n').length - 1))} aria-invalid={!v.valid} />
        <div className="draft-foot">
          <span className={`counter ${v.valid ? '' : 'over'}`} title="X counts every URL as 23 characters">
            {v.length} / {X_LIMIT}{v.over ? ` — ${v.over} over` : ''}{v.empty ? ' — empty' : ''}
          </span>
          <CopyButton text={text} label="Copy tweet" disabled={!text.trim()} />
        </div>
      </div>
    </li>
  );
}

export function XSection({ drafting, onRetry, onRegenerate, onEditTweet, onConfig }) {
  const ids = drafting.ideas.map((i) => i.id);
  const agent = drafting.x;
  return (
    <section className="card" aria-labelledby="x-h">
      <div className="card-head"><h2 id="x-h">4b · X threads</h2></div>
      <AgentHeader title="X / Twitter Agent" subtitle="One thread per idea for developers at Bay Area startups. Every tweet is validated against X's 280-character rules (URLs count as 23)." agent={agent} ids={ids} onRetryFailed={() => onRetry(ids.filter((id) => agent.items[id]?.status === 'error'))} onRegenerateAll={() => onRetry(ids)} />
      <ErrorBanner error={agent.error} />
      {drafting.ideas.map((idea) => {
        const item = agent.items[idea.id];
        const cfg = drafting.config[idea.id];
        const countBad = !validCount(cfg.tweetCount);
        const tweets = item?.tweets || [];
        const allValid = tweets.length > 0 && tweets.every((t) => validateTweet(t).valid);
        return (
          <ItemShell
            key={idea.id}
            idea={idea}
            item={item}
            disabled={countBad}
            onRegenerate={() => onRegenerate([idea.id])}
            extra={
              <label className="inline-count">
                Tweets
                <input type="number" min={MIN_TWEETS} max={MAX_TWEETS} value={cfg.tweetCount ?? ''} onChange={(e) => onConfig(idea.id, { tweetCount: e.target.value === '' ? NaN : Number(e.target.value) })} aria-invalid={countBad} />
              </label>
            }
          >
            <Warnings warnings={item?.warnings} />
            {!allValid && <div className="banner banner-warn">At least one tweet is outside X's limits. Edit it below or regenerate before posting.</div>}
            <ol className="tweets">
              {tweets.map((t, i) => (
                <TweetBox key={i} index={i} text={t} onChange={(v) => onEditTweet(idea.id, i, v)} />
              ))}
            </ol>
            <div className="draft-foot">
              <span className="muted small">{tweets.length} tweets · {tweets.reduce((n, t) => n + xWeightedLength(t), 0)} weighted characters total</span>
              <CopyButton text={tweets.join('\n\n')} label="Copy whole thread" />
            </div>
          </ItemShell>
        );
      })}
    </section>
  );
}
