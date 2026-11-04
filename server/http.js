import { AppError } from './errors.js';
import { redact } from './redact.js';

const MAX_BODY_BYTES = 1_000_000;

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

export function sendError(res, err, secrets = []) {
  if (err instanceof AppError) {
    const body = err.toJSON();
    body.error.message = redact(body.error.message, secrets);
    return sendJson(res, err.status, body);
  }
  // Unknown error: never echo its message, it could contain anything.
  return sendJson(res, 500, {
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server. Check the server console.' },
  });
}

export async function readJson(req) {
  const type = String(req.headers['content-type'] || '');
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new AppError('BAD_REQUEST', 'Requests must be sent as application/json.', { status: 415 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new AppError('BAD_REQUEST', 'Request body is too large.', { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('BAD_REQUEST', 'Request body is not valid JSON.', { status: 400 });
  }
}

// CSRF defence on top of SameSite=Strict: browsers always send Origin on
// cross-site and non-GET requests, so require it to match the Host.
export function assertSameOrigin(req, allowedOrigins = []) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.origin;
  if (!origin) return; // non-browser client (curl, tests); cookies can't be forged cross-site without Origin
  const host = req.headers.host;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = '';
  }
  if (originHost !== host && !allowedOrigins.includes(origin)) {
    throw new AppError('FORBIDDEN_ORIGIN', 'Cross-origin requests are not allowed.', { status: 403 });
  }
}
