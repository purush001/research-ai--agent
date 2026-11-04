import { AppError } from '../errors.js';
import { redact } from '../redact.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with a timeout and one retry on network errors / 5xx. Never throws the
 * raw fetch error (its message/cause can contain the request URL, which for
 * SerpAPI carries the key); throws an AppError instead.
 */
export async function providerFetch(url, init, { provider, timeoutMs, secrets = [], retries = 1 }) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status >= 500 && attempt < retries) {
        await res.arrayBuffer().catch(() => {});
        await sleep(1000);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        throw new AppError('TIMEOUT', `${provider} did not respond within ${Math.round(timeoutMs / 1000)} seconds.`, {
          status: 504,
          provider,
          hint: 'Try again. If it keeps happening, check your network connection.',
        });
      }
      if (attempt < retries) await sleep(1000);
    }
  }
  throw new AppError('NETWORK_ERROR', `Could not reach ${provider}: ${redact(lastErr?.cause?.code || lastErr?.message || 'network error', secrets)}.`, {
    status: 502,
    provider,
    hint: 'Check your internet connection and any proxy settings, then retry.',
  });
}

export function retryAfterSeconds(res) {
  const h = res.headers.get('retry-after');
  const n = h ? Number(h) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export async function readBodySafely(res) {
  const text = await res.text().catch(() => '');
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
}
