import { DEFAULT_TWEETS, MAX_TWEETS, MIN_TWEETS, isHttpUrl } from '../../shared/constants.js';
import { CATEGORY_META } from '../format.js';

export { DEFAULT_TWEETS, MAX_TWEETS, MIN_TWEETS };

/** A blank CTA field is valid (it means "no CTA"). */
export const validUrl = (s) => !s || isHttpUrl(s);

export const validCount = (n) => Number.isInteger(n) && n >= MIN_TWEETS && n <= MAX_TWEETS;

export default function Approval({ ideas, config, onConfig, onStart }) {
  const invalid = ideas.some((i) => !validUrl(config[i.id]?.ctaUrl?.trim()) || !validCount(config[i.id]?.tweetCount));
  return (
    <div className="approval" aria-labelledby="approval-h">
      <h3 id="approval-h">Settings for your 3 approved ideas</h3>
      <p className="muted small">
        Set a call-to-action link for each LinkedIn post (leave blank for none; sources are always included) and the number of tweets for each X thread.
        Then explicitly start drafting — both writing agents run at the same time.
      </p>
      {ideas.map((idea) => {
        const c = config[idea.id] || {};
        const urlBad = !validUrl(c.ctaUrl?.trim());
        const countBad = !validCount(c.tweetCount);
        return (
          <div key={idea.id} className="approval-row">
            <div className="approval-title">
              <span className={`chip chip-${idea.category}`}>{CATEGORY_META[idea.category].label}</span>
              <strong>{idea.headline}</strong>
            </div>
            <div className="grid-approval">
              <div className="field">
                <label htmlFor={`cta-${idea.id}`}>LinkedIn CTA URL <span className="muted">(optional)</span></label>
                <input id={`cta-${idea.id}`} type="url" inputMode="url" placeholder="https://…" value={c.ctaUrl || ''} onChange={(e) => onConfig(idea.id, { ctaUrl: e.target.value })} aria-invalid={urlBad} />
                {urlBad && <div className="field-error">Enter a full http(s) link, or leave blank.</div>}
              </div>
              <div className="field">
                <label htmlFor={`count-${idea.id}`}>Tweets in thread</label>
                <input id={`count-${idea.id}`} type="number" min={MIN_TWEETS} max={MAX_TWEETS} step={1} value={c.tweetCount ?? ''} onChange={(e) => onConfig(idea.id, { tweetCount: e.target.value === '' ? NaN : Number(e.target.value) })} aria-invalid={countBad} />
                {countBad && <div className="field-error">Whole number, {MIN_TWEETS}–{MAX_TWEETS}.</div>}
              </div>
            </div>
          </div>
        );
      })}
      <button className="btn btn-primary btn-large" onClick={onStart} disabled={invalid}>
        Approve these 3 ideas &amp; start drafting
      </button>
    </div>
  );
}
