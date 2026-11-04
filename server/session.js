import { randomBytes } from 'node:crypto';
import { config } from './config.js';

// Credentials live only in this process's memory, keyed by a random session id
// that the browser holds in an HttpOnly, SameSite=Strict cookie. Nothing is
// written to disk, to logs, or to browser storage, and the frontend build never
// sees a key.

const sessions = new Map();

function sweep(now = Date.now()) {
  for (const [id, s] of sessions) if (now - s.touched > config.sessionIdleMs) sessions.delete(id);
}

export function createSession() {
  sweep();
  const id = randomBytes(32).toString('base64url');
  const session = { id, openaiKey: '', serpapiKey: '', touched: Date.now() };
  sessions.set(id, session);
  return session;
}

export function getSession(id) {
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() - s.touched > config.sessionIdleMs) {
    sessions.delete(id);
    return null;
  }
  s.touched = Date.now();
  return s;
}

export function destroySession(id) {
  sessions.delete(id);
}

export function sessionSecrets(session) {
  return [session?.openaiKey, session?.serpapiKey].filter(Boolean);
}
