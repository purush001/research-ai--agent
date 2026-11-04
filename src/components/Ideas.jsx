import { CATEGORIES, CATEGORY_META, fmtDate } from '../format.js';

function Sources({ sources }) {
  return (
    <ul className="sources">
      {sources.map((s) => (
        <li key={s.url}>
          <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.url}</a>
          <span className="muted">
            {' '}— {s.publisher || 'unknown publisher'}, {fmtDate(s.publishedAt)}
          </span>
          {s.isPrimary && <span className="badge badge-primary">primary source</span>}
        </li>
      ))}
    </ul>
  );
}

function IdeaCard({ idea, approved, canApprove, note, onNote, onToggle, locked }) {
  const id = `idea-${idea.id}`;
  return (
    <article className={`idea ${approved ? 'approved' : ''}`} aria-labelledby={`${id}-h`}>
      <header className="idea-head">
        <span className={`chip chip-${idea.category}`}>{CATEGORY_META[idea.category].label}</span>
        <label className="approve">
          <input type="checkbox" checked={approved} disabled={locked || (!approved && !canApprove)} onChange={() => onToggle(idea.id)} />
          <span>{approved ? 'Approved' : 'Approve'}</span>
        </label>
      </header>
      <h5 id={`${id}-h`}>{idea.headline}</h5>
      <p>{idea.summary}</p>
      <dl className="facts">
        <div className="fact fact-confirmed">
          <dt>Confirmed by sources</dt>
          <dd>{idea.confirmedDevelopment}</dd>
        </div>
        <div className="fact fact-proposed">
          <dt>Proposed application (our inference)</dt>
          <dd>{idea.proposedApplication}</dd>
        </div>
        <div className="fact">
          <dt>Proposed angle</dt>
          <dd>{idea.angle}</dd>
        </div>
      </dl>
      <Sources sources={idea.sources} />
      <label className="notes-label" htmlFor={`${id}-notes`}>Editorial notes <span className="muted">(optional — passed to both writing agents)</span></label>
      <textarea id={`${id}-notes`} rows={2} value={note} onChange={(e) => onNote(idea.id, e.target.value)} placeholder="e.g. Emphasize rollback and audit logging; avoid naming vendors other than Oracle." maxLength={2000} disabled={locked} />
    </article>
  );
}

export default function Ideas({ ideas, approvedIds, notes, onNote, onToggle, locked }) {
  const canApprove = approvedIds.length < 3;
  return (
    <div className="ideas">
      <div className="ideas-head">
        <h3>{ideas.length} content ideas</h3>
        <span className={`badge ${approvedIds.length === 3 ? 'badge-ok' : 'badge-neutral'}`}>{approvedIds.length} of 3 approved</span>
      </div>
      <p className="muted small">Approve exactly three ideas, from any category. Nothing is drafted until you confirm below.</p>
      {CATEGORIES.map((c) => {
        const group = ideas.filter((i) => i.category === c);
        return (
          <div key={c} className="group">
            <h4 className="group-title">
              {CATEGORY_META[c].label} <span className="muted">{group.length} of {CATEGORY_META[c].quota}</span>
            </h4>
            {group.length === 0 && <p className="empty">No verified ideas in this category for the search window.</p>}
            {group.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} approved={approvedIds.includes(idea.id)} canApprove={canApprove} note={notes[idea.id] || ''} onNote={onNote} onToggle={onToggle} locked={locked} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
