import { isAppError } from '../errors.js';
import { openingPasses, reviewOpenings } from './review.js';

// Shared engine for the LinkedIn and X agents: generate -> validate -> repair ->
// independent opening review -> per-idea results. Each platform supplies an
// adapter; validation problems are structured issues ({ code, message }) so
// callers compare codes instead of pattern-matching message text.

const TRANSIENT = new Set(['BAD_MODEL_OUTPUT', 'UPSTREAM_ERROR', 'TIMEOUT', 'NETWORK_ERROR']);
const MAX_TRANSIENT_RETRIES = 2;

const errorResult = (idea, lastError, noun) => ({
  ideaId: idea.id,
  ok: false,
  error: lastError
    ? { code: lastError.code || 'ERROR', message: lastError.message, hint: lastError.hint, retryAfter: lastError.retryAfter }
    : { code: 'BAD_MODEL_OUTPUT', message: `The model did not return a usable ${noun} for this idea.` },
});

/**
 * adapter: {
 *   platform, noun, audience, openingRules, maxAttempts,
 *   countFor(idea)                       -> value passed to validate (tweet count) or undefined
 *   generate(session, pending, attempt)  -> parsed model output
 *   draftFor(out, number)                -> draft | undefined
 *   usable(draft)                        -> can this draft be shown even if invalid?
 *   validate(draft, idea, count)         -> [{ code, message }]
 *   describe(draft)                      -> value echoed back to the model when repairing
 *   reviewItem(idea, number, draft)      -> item for the opening review
 *   withOpening(draft, opening)          -> draft with the opening replaced
 *   result(idea, draft, warnings, hookRevised) -> platform-specific ok result
 * }
 * Always resolves with one result per idea, unless nothing at all could be
 * drafted because of a provider error, in which case that error is thrown.
 */
export async function runDraftingAgent(session, ideas, adapter) {
  const numbered = ideas.map((idea, i) => ({ idea, number: i + 1, count: adapter.countFor(idea) }));
  const results = new Map(); // number -> { draft, warnings, hookRevised }
  let pending = numbered.map((n) => ({ ...n, feedback: null, previous: null, fallback: null }));
  let lastError = null;
  let transientLeft = MAX_TRANSIENT_RETRIES;

  for (let attempt = 1; attempt <= adapter.maxAttempts && pending.length; attempt++) {
    let out;
    try {
      out = await adapter.generate(session, pending, attempt);
      lastError = null;
    } catch (e) {
      lastError = e;
      if (isAppError(e) && TRANSIENT.has(e.code) && transientLeft-- > 0) {
        attempt--; // a transient failure does not use up a repair attempt
        continue;
      }
      break;
    }
    const next = [];
    for (const p of pending) {
      const draft = adapter.draftFor(out, p.number);
      if (!draft) {
        next.push({ ...p, feedback: [`no ${adapter.noun} was returned for this idea`] });
        continue;
      }
      const issues = adapter.validate(draft, p.idea, p.count);
      if (!issues.length) results.set(p.number, { draft, warnings: [] });
      else if (attempt === adapter.maxAttempts && adapter.usable(draft)) {
        results.set(p.number, { draft, warnings: issues.map((i) => `Validation: ${i.message}.`) });
      } else {
        next.push({ ...p, feedback: issues.map((i) => i.message), previous: adapter.describe(draft), fallback: { draft, issues } });
      }
    }
    pending = next;
  }

  // A repair call that failed must not throw away a draft we already have.
  for (const p of pending) {
    if (p.fallback && adapter.usable(p.fallback.draft)) {
      const why = lastError ? ` Repair failed: ${lastError.message}` : '';
      results.set(p.number, {
        draft: p.fallback.draft,
        warnings: [...p.fallback.issues.map((i) => `Validation: ${i.message}.`), ...(why ? [why.trim()] : [])],
      });
    }
  }

  if (lastError && !results.size) throw lastError;

  await reviewAndRevise(session, numbered, results, adapter);

  return numbered.map(({ idea, number }) => {
    const r = results.get(number);
    return r ? adapter.result(idea, r.draft, r.warnings, !!r.hookRevised) : errorResult(idea, lastError, adapter.noun);
  });
}

async function reviewAndRevise(session, numbered, results, adapter) {
  const drafted = numbered.filter((n) => results.has(n.number));
  if (!drafted.length) return;
  try {
    const reviews = await reviewOpenings(session, {
      platform: adapter.platform,
      audience: adapter.audience,
      openingRules: adapter.openingRules,
      items: drafted.map(({ idea, number }) => adapter.reviewItem(idea, number, results.get(number).draft)),
    });
    for (const { idea, number, count } of drafted) {
      const review = reviews.get(number);
      const entry = results.get(number);
      if (!review || openingPasses(review)) continue;
      const opening = (review.revisedOpening || '').trim();
      const revised = opening ? adapter.withOpening(entry.draft, opening) : null;
      // Accept the rewrite only if it introduces no validation problem the draft did not already have.
      const before = new Set(adapter.validate(entry.draft, idea, count).map((i) => i.code));
      const introduced = revised ? adapter.validate(revised, idea, count).filter((i) => !before.has(i.code)) : [true];
      if (revised && !introduced.length) {
        entry.draft = revised;
        entry.warnings.push(`Opening rewritten after review: ${review.problem}`);
        entry.hookRevised = true;
      } else {
        entry.warnings.push(`Opening may be weak: ${review.problem}`);
      }
    }
  } catch {
    for (const { number } of drafted) results.get(number).warnings.push(`The automatic opening review could not run; read the ${adapter.platform === 'x' ? 'first tweet' : 'first lines'} yourself.`);
  }
}
