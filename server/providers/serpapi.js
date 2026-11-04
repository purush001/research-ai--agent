import { config } from '../config.js';
import { AppError } from '../errors.js';
import { redact } from '../redact.js';
import { providerFetch, readBodySafely, retryAfterSeconds } from './http.js';

const PROVIDER = 'SerpAPI';

function mapSerpError(status, json, res, key) {
  const msg = redact(json?.error || '', [key]);
  if (status === 401 || /invalid api key|api key.*(invalid|missing)/i.test(msg)) {
    return new AppError('INVALID_SERPAPI_KEY', 'SerpAPI rejected the API key.', {
      status: 401,
      provider: PROVIDER,
      hint: 'Open Settings and enter a valid SerpAPI key.',
    });
  }
  if (status === 429 || /run out of searches|plan.*(limit|exceeded)|rate/i.test(msg)) {
    const quota = /run out of searches|plan.*(limit|exceeded)/i.test(msg);
    return new AppError(quota ? 'SERPAPI_QUOTA' : 'RATE_LIMITED', quota ? 'Your SerpAPI plan has no searches left.' : 'SerpAPI rate limit reached. Wait a moment and retry.', {
      status: 429,
      provider: PROVIDER,
      retryAfter: retryAfterSeconds(res),
      hint: quota ? 'Check your plan at serpapi.com/manage-api-key.' : 'Wait for the suggested time, then retry.',
    });
  }
  return new AppError('SEARCH_FAILED', `SerpAPI search failed (${status})${msg ? `: ${msg}` : ''}.`, {
    status: 502,
    provider: PROVIDER,
  });
}

/** Account lookup does not consume a search credit. */
export async function checkSerpApiKey(key) {
  const url = `${config.serpapiBaseUrl}/account?api_key=${encodeURIComponent(key)}`;
  const res = await providerFetch(url, {}, { provider: PROVIDER, timeoutMs: 20_000, secrets: [key] });
  const { json } = await readBodySafely(res);
  if (!res.ok) throw mapSerpError(res.status, json, res, key);
  return { valid: true, searchesLeft: json?.total_searches_left ?? json?.plan_searches_left ?? null };
}

/** One Google News search. `tbs` carries Google's recency filter. */
export async function searchNews(session, { query, tbs, num = 10 }) {
  const key = session.serpapiKey;
  const params = new URLSearchParams({
    engine: 'google',
    tbm: 'nws',
    q: query,
    num: String(num),
    hl: 'en',
    gl: 'us',
    api_key: key,
  });
  if (tbs) params.set('tbs', tbs);
  const res = await providerFetch(`${config.serpapiBaseUrl}/search.json?${params}`, {}, {
    provider: PROVIDER,
    timeoutMs: config.serpapiTimeoutMs,
    secrets: [key],
  });
  const { json } = await readBodySafely(res);
  // "Google hasn't returned any results for this query" is reported as an error
  // string, sometimes with a 200, but it just means an empty result set.
  if (/hasn't returned any results/i.test(json?.error || '')) return [];
  if (!res.ok || json?.error) throw mapSerpError(res.status, json, res, key);
  return json?.news_results || [];
}
