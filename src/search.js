// Google News results through SerpAPI. Requests go via the /serpapi proxy
// configured in vite.config.js (override with VITE_SERPAPI_BASE if you host
// your own proxy).
const BASE = import.meta.env.VITE_SERPAPI_BASE || '/serpapi';

export async function searchNews({ apiKey, q, period = 'w', num = 10 }) {
  const params = new URLSearchParams({
    engine: 'google',
    tbm: 'nws',
    q,
    num: String(num),
    tbs: `qdr:${period}`,
    api_key: apiKey,
  });
  const res = await fetch(`${BASE}/search.json?${params}`);
  let body = {};
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok || body.error) {
    throw new Error(`SerpAPI ${res.status}: ${body.error || res.statusText}`);
  }
  return (body.news_results || []).map((r) => ({
    title: r.title,
    url: r.link,
    source: typeof r.source === 'object' ? r.source?.name : r.source,
    date: r.date,
    snippet: r.snippet || '',
  }));
}
