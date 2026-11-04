// Thin client for the local backend. Credentials are never stored or sent from
// here after the one-time "save keys" call; the server keeps them in memory.

export class ApiError extends Error {
  constructor({ code = 'ERROR', message = 'Request failed.', hint, retryAfter, provider, status }) {
    super(message);
    Object.assign(this, { code, hint, retryAfter, provider, status });
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError({
      code: 'NETWORK',
      message: 'Could not reach the local server.',
      hint: 'Make sure `npm run dev` (or `npm start`) is still running, then retry.',
    });
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (json?.error) throw new ApiError({ ...json.error, status: res.status });
    if (json?.errors) return json; // key validation results are returned as data
    throw new ApiError({ code: `HTTP_${res.status}`, message: `The server returned an unexpected response (${res.status}).`, status: res.status });
  }
  return json;
}

export const api = {
  getSession: () => request('GET', '/session'),
  saveKeys: (keys) => request('PUT', '/session', keys),
  clearKeys: () => request('DELETE', '/session'),
  research: (payload) => request('POST', '/research', payload),
  linkedin: (ideas) => request('POST', '/linkedin', { ideas }),
  x: (ideas) => request('POST', '/x', { ideas }),
};

export function describeError(e) {
  const err = e instanceof ApiError ? e : new ApiError({ message: e?.message || 'Unexpected error.' });
  return {
    code: err.code,
    message: err.message,
    hint: err.hint,
    retryAfter: err.retryAfter,
    provider: err.provider,
  };
}
