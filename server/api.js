import { config } from './config.js';
import { AppError, isAppError } from './errors.js';
import { assertSameOrigin, parseCookies, readJson, sendError, sendJson } from './http.js';
import { createSession, destroySession, getSession, sessionSecrets } from './session.js';
import { checkOpenAIKey } from './providers/openai.js';
import { checkSerpApiKey } from './providers/serpapi.js';
import { CATEGORIES, QUOTAS, missingCounts, runResearch } from './agents/research.js';
import { runLinkedIn } from './agents/linkedin.js';
import { MAX_TWEETS, MIN_TWEETS, runX } from './agents/x.js';
import { redact } from './redact.js';

const COOKIE = 'sid';
const MAX_KEY_LENGTH = 400;

const isHttpUrl = (s) => {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cookieHeader(req, id) {
  const secure = req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(id)}; Path=/api; HttpOnly; SameSite=Strict${secure}`;
}

function sessionStatus(session) {
  return {
    model: config.model,
    configured: { openai: !!session?.openaiKey, serpapi: !!session?.serpapiKey },
  };
}

function requireKeys(session, { openai, serpapi }) {
  if (openai && !session?.openaiKey) {
    throw new AppError('MISSING_KEY', 'Add your OpenAI API key in Settings first.', { status: 401, provider: 'OpenAI' });
  }
  if (serpapi && !session?.serpapiKey) {
    throw new AppError('MISSING_KEY', 'Add your SerpAPI key in Settings first.', { status: 401, provider: 'SerpAPI' });
  }
}

/* ----------------------------- body validation ---------------------------- */

function parseWindow(body, now = new Date()) {
  const start = new Date(body.windowStart);
  if (Number.isNaN(start.getTime())) throw new AppError('BAD_REQUEST', 'windowStart must be an ISO timestamp.', { status: 400 });
  let end = body.windowEnd ? new Date(body.windowEnd) : now;
  if (Number.isNaN(end.getTime())) throw new AppError('BAD_REQUEST', 'windowEnd must be an ISO timestamp.', { status: 400 });
  if (end > now) end = now;
  const earliest = new Date(end.getTime() - config.maxWindowDays * 86_400_000);
  const clamped = start < earliest;
  const effectiveStart = clamped ? earliest : start;
  if (end.getTime() - effectiveStart.getTime() < 60_000) {
    throw new AppError('BAD_REQUEST', 'The search window is empty. Choose an earlier start.', { status: 400 });
  }
  return { start: effectiveStart, end, clamped };
}

function parseExisting(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 20).map((i) => ({
    headline: str(i?.headline, 300),
    category: CATEGORIES.includes(i?.category) ? i.category : 'general',
    sources: Array.isArray(i?.sources) ? i.sources.filter((s) => isHttpUrl(s?.url)).map((s) => ({ url: s.url })) : [],
  }));
}

function parseApprovedIdeas(body, platform) {
  const list = body.ideas;
  if (!Array.isArray(list) || list.length < 1 || list.length > 3) {
    throw new AppError('BAD_REQUEST', 'Send between 1 and 3 approved ideas.', { status: 400 });
  }
  return list.map((raw, n) => {
    const sources = (Array.isArray(raw.sources) ? raw.sources : [])
      .filter((s) => isHttpUrl(s?.url))
      .slice(0, 8)
      .map((s) => ({
        title: str(s.title, 300),
        publisher: str(s.publisher, 120),
        url: String(s.url),
        publishedAt: typeof s.publishedAt === 'string' && !Number.isNaN(Date.parse(s.publishedAt)) ? s.publishedAt : null,
        isPrimary: !!s.isPrimary,
      }));
    if (!sources.length) throw new AppError('BAD_REQUEST', `Idea ${n + 1} has no valid source links.`, { status: 400 });
    const idea = {
      id: str(raw.id, 80) || `idea-${n + 1}`,
      category: CATEGORIES.includes(raw.category) ? raw.category : 'general',
      headline: str(raw.headline, 300),
      summary: str(raw.summary, 1500),
      angle: str(raw.angle, 800),
      confirmedDevelopment: str(raw.confirmedDevelopment, 1500),
      proposedApplication: str(raw.proposedApplication, 1500),
      notes: str(raw.notes, 2000),
      sources,
    };
    if (!idea.headline) throw new AppError('BAD_REQUEST', `Idea ${n + 1} has no headline.`, { status: 400 });
    if (platform === 'linkedin') {
      const cta = str(raw.ctaUrl, 2000);
      if (cta && !isHttpUrl(cta)) {
        throw new AppError('BAD_REQUEST', `The CTA URL for "${idea.headline}" is not a valid http(s) link.`, { status: 400 });
      }
      idea.ctaUrl = cta;
    } else {
      const count = Number(raw.tweetCount);
      if (!Number.isInteger(count) || count < MIN_TWEETS || count > MAX_TWEETS) {
        throw new AppError('BAD_REQUEST', `Tweet count must be a whole number from ${MIN_TWEETS} to ${MAX_TWEETS}.`, { status: 400 });
      }
      idea.tweetCount = count;
    }
    return idea;
  });
}

/* --------------------------------- routes --------------------------------- */

async function putSession(req, res, session) {
  const body = await readJson(req);
  const openaiKey = str(body.openaiKey, MAX_KEY_LENGTH);
  const serpapiKey = str(body.serpapiKey, MAX_KEY_LENGTH);
  if (!openaiKey && !serpapiKey) throw new AppError('BAD_REQUEST', 'Enter at least one API key.', { status: 400 });
  if (/\s/.test(openaiKey) || /\s/.test(serpapiKey)) {
    throw new AppError('BAD_REQUEST', 'API keys cannot contain spaces or line breaks.', { status: 400 });
  }

  // Validate each provided key before storing it, so errors show up here and not mid-run.
  const result = {};
  const checks = [];
  if (openaiKey) checks.push(checkOpenAIKey(openaiKey).then((r) => ({ name: 'openai', key: openaiKey, r }), (e) => ({ name: 'openai', e })));
  if (serpapiKey) checks.push(checkSerpApiKey(serpapiKey).then((r) => ({ name: 'serpapi', key: serpapiKey, r }), (e) => ({ name: 'serpapi', e })));
  const settled = await Promise.all(checks);

  const target = session || createSession();
  const errors = {};
  for (const s of settled) {
    if (s.e) {
      errors[s.name] = isAppError(s.e) ? s.e.toJSON().error : { code: 'ERROR', message: 'Could not validate this key.' };
    } else if (s.name === 'openai') {
      target.openaiKey = s.key;
      result.openai = { valid: true, modelAvailable: s.r.modelAvailable };
    } else {
      target.serpapiKey = s.key;
      result.serpapi = { valid: true, searchesLeft: s.r.searchesLeft };
    }
  }
  return { session: target, result, errors };
}

async function handle(req, res, route, session) {
  const { method } = req;

  if (route === '/health' && method === 'GET') return sendJson(res, 200, { ok: true });

  if (route === '/session') {
    if (method === 'GET') return sendJson(res, 200, sessionStatus(session));
    if (method === 'DELETE') {
      if (session) destroySession(session.id);
      return sendJson(res, 200, sessionStatus(null), { 'set-cookie': `${COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0` });
    }
    if (method === 'PUT') {
      const { session: target, result, errors } = await putSession(req, res, session);
      const headers = target.openaiKey || target.serpapiKey ? { 'set-cookie': cookieHeader(req, target.id) } : {};
      if (!target.openaiKey && !target.serpapiKey) destroySession(target.id);
      return sendJson(res, Object.keys(errors).length && !Object.keys(result).length ? 400 : 200, { ...sessionStatus(target), result, errors }, headers);
    }
  }

  if (route === '/research' && method === 'POST') {
    requireKeys(session, { openai: true, serpapi: true });
    const body = await readJson(req);
    const now = new Date();
    const { start, end, clamped } = parseWindow(body, now);
    const existing = parseExisting(body.existing);
    const needs = {};
    const have = missingCounts(existing.map((e) => ({ category: e.category })));
    for (const c of CATEGORIES) {
      // Initial run asks for the full quota; a widen run asks only for what is still missing.
      needs[c] = body.needs ? Math.max(0, Math.min(QUOTAS[c], Math.floor(Number(body.needs[c]) || 0))) : QUOTAS[c];
      needs[c] = Math.min(needs[c], have[c]);
    }
    const out = await runResearch(session, { start, end, needs, existing, now });
    const all = [...existing.map((e) => ({ category: e.category })), ...out.ideas];
    return sendJson(res, 200, {
      window: { start: start.toISOString(), end: end.toISOString(), clamped, maxDays: config.maxWindowDays },
      ideas: out.ideas,
      missing: missingCounts(all),
      dropped: out.dropped,
      searchStats: out.stats,
      warnings: out.warnings,
    });
  }

  if (route === '/linkedin' && method === 'POST') {
    requireKeys(session, { openai: true });
    const ideas = parseApprovedIdeas(await readJson(req), 'linkedin');
    return sendJson(res, 200, { posts: await runLinkedIn(session, ideas) });
  }

  if (route === '/x' && method === 'POST') {
    requireKeys(session, { openai: true });
    const ideas = parseApprovedIdeas(await readJson(req), 'x');
    return sendJson(res, 200, { threads: await runX(session, ideas) });
  }

  throw new AppError('NOT_FOUND', 'Unknown API route.', { status: 404 });
}

/**
 * Returns an async (req, res) => boolean. It handles /api/* requests and
 * returns false for everything else so a static server can take over.
 */
export function createApiHandler({ log = true } = {}) {
  return async function apiHandler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    const started = Date.now();
    let session = null;
    try {
      assertSameOrigin(req, config.allowedOrigins);
      session = getSession(parseCookies(req.headers.cookie)[COOKIE]);
      await handle(req, res, url.pathname.slice(4), session);
    } catch (e) {
      // Only AppErrors carry user-safe messages; everything is redacted regardless.
      sendError(res, e, sessionSecrets(session));
      if (!isAppError(e) && log) console.error('[api] unexpected error:', redact(e?.stack || e?.message || e, sessionSecrets(session)));
    }
    // Logs: method, path (no query string), status, duration. Never headers or bodies.
    if (log) console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    return true;
  };
}
