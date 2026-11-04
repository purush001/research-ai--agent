import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startMockProviders } from './mock-providers.js';

let mock, server, base, logs;
const OPENAI_KEY = 'sk-test-SECRET-openai-key-123456';
const SERP_KEY = 'serp-SECRET-key-abcdef123456';
let cookie = '';

before(async () => {
  mock = await startMockProviders();
  process.env.OPENAI_BASE_URL = `${mock.url}/v1`;
  process.env.SERPAPI_BASE_URL = mock.url;
  const { createApiHandler } = await import('../server/api.js');
  logs = [];
  for (const m of ['log', 'error', 'warn']) {
    const orig = console[m];
    console[m] = (...a) => { logs.push(a.join(' ')); if (!process.env.QUIET_TESTS) orig(...a); };
  }
  const api = createApiHandler({ log: true });
  server = createServer(async (req, res) => { if (!(await api(req, res))) res.writeHead(404).end(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await mock.close(); });

async function call(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set && /^sid=[^;]+/.test(set)) cookie = set.split(';')[0];
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: text ? JSON.parse(text) : null };
}

test('invalid keys are rejected with clear, key-free errors', async () => {
  let r = await call('PUT', '/api/session', { openaiKey: 'sk-bad-INVALIDKEY-999999' });
  assert.equal(r.status, 400);
  assert.equal(r.json.errors.openai.code, 'INVALID_OPENAI_KEY');
  assert.ok(!r.text.includes('INVALIDKEY'), 'provider echo of the key must be scrubbed');
  r = await call('PUT', '/api/session', { serpapiKey: 'bad-serp-key-1234567' });
  assert.equal(r.json.errors.serpapi.code, 'INVALID_SERPAPI_KEY');
  assert.equal(cookie, '', 'no session is created for invalid keys');
  r = await call('POST', '/api/research', { windowStart: new Date().toISOString() });
  assert.equal(r.status, 401);
  assert.equal(r.json.error.code, 'MISSING_KEY');
});

test('valid keys: stored server-side, cookie is HttpOnly + SameSite=Strict, status never returns keys', async () => {
  const r = await call('PUT', '/api/session', { openaiKey: OPENAI_KEY, serpapiKey: SERP_KEY });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.configured, { openai: true, serpapi: true });
  assert.equal(r.json.result.serpapi.searchesLeft, 241);
  const set = r.headers.get('set-cookie');
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
  assert.ok(!set.includes(OPENAI_KEY));
  const s = await call('GET', '/api/session');
  assert.ok(!s.text.includes('SECRET'));
  assert.equal(s.json.model, 'gpt-6.1-sol');
});

test('cross-origin writes are refused', async () => {
  const r = await call('POST', '/api/linkedin', { ideas: [] }, { origin: 'http://evil.example' });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, 'FORBIDDEN_ORIGIN');
});

let ideas = [];
test('research: 24h window, category quotas, missing counts, then widening fills the gap', async () => {
  const start = new Date(Date.now() - 24 * 3_600_000).toISOString();
  let r = await call('POST', '/api/research', { windowStart: start });
  assert.equal(r.status, 200, r.text);
  const by = (c) => r.json.ideas.filter((i) => i.category === c);
  assert.equal(by('oracle').length, 2);
  assert.equal(by('general').length, 6);
  assert.equal(by('peoplesoft').length, 1, 'only one PeopleSoft story is inside 24h');
  assert.deepEqual(r.json.missing, { oracle: 0, peoplesoft: 1, general: 0 });
  for (const i of r.json.ideas) {
    assert.ok(i.sources.length >= 1 && i.sources.every((s) => s.url.startsWith('http')));
    assert.ok(i.sources.some((s) => s.publishedAt), 'every idea has a dated source');
    assert.ok(i.confirmedDevelopment && i.proposedApplication);
  }
  assert.equal(new Set(r.json.ideas.map((i) => i.sources[0].url)).size, r.json.ideas.length, 'no story twice');
  assert.ok(Date.parse(r.json.window.end) - Date.parse(r.json.window.start) <= 24 * 3_600_000 + 1000);
  assert.ok(r.json.searchStats.searches >= 10);
  ideas = r.json.ideas;

  // widen to 7 days for the missing category only
  const wide = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const w = await call('POST', '/api/research', { windowStart: wide, windowEnd: r.json.window.end, needs: r.json.missing, existing: ideas.map(({ headline, category, sources }) => ({ headline, category, sources })) });
  assert.equal(w.status, 200, w.text);
  assert.equal(w.json.ideas.length, 1);
  assert.equal(w.json.ideas[0].category, 'peoplesoft');
  assert.deepEqual(w.json.missing, { oracle: 0, peoplesoft: 0, general: 0 });
  assert.equal(w.json.window.end, r.json.window.end, 'widening keeps the original window end');
  ideas = [...ideas, ...w.json.ideas];
  assert.equal(ideas.length, 10);
});

const pick = () => [ideas[0], ideas.find((i) => i.category === 'peoplesoft'), ideas.find((i) => i.category === 'general')];

test('LinkedIn: one post per idea, sources always, CTA URL only where provided', async () => {
  const [a, b, c] = pick();
  const r = await call('POST', '/api/linkedin', {
    ideas: [{ ...a, ctaUrl: 'https://example.org/my-guide', notes: 'Mention rollback.' }, { ...b, ctaUrl: '' }, { ...c }],
  });
  assert.equal(r.status, 200, r.text);
  const posts = r.json.posts;
  assert.equal(posts.length, 3);
  posts.forEach((p, i) => {
    assert.equal(p.ok, true, JSON.stringify(p));
    for (const s of [a, b, c][i].sources) assert.ok(p.text.includes(s.url), 'supporting source link present');
    assert.ok(p.text.length <= 3000);
    assert.ok(p.text.startsWith(p.hook));
  });
  assert.match(posts[0].text, /If you want the checklist I use for these pilots, it is here:\nhttps:\/\/example\.org\/my-guide$/);
  assert.ok(!posts[1].text.includes('example.org') && !posts[2].text.includes('example.org'));
});

test('LinkedIn: rejects a malformed CTA URL', async () => {
  const [a] = pick();
  const r = await call('POST', '/api/linkedin', { ideas: [{ ...a, ctaUrl: 'javascript:alert(1)' }] });
  assert.equal(r.status, 400);
  assert.match(r.json.error.message, /CTA URL/);
});

test('X: independent tweet counts are honoured exactly and every tweet fits 280', async () => {
  const { xWeightedLength } = await import('../shared/xlength.js');
  const [a, b, c] = pick();
  mock.state.xOverlongRemaining = 1; // first attempt returns a 300-char tweet 1 -> must be repaired
  const r = await call('POST', '/api/x', { ideas: [{ ...a, tweetCount: 1 }, { ...b, tweetCount: 4 }, { ...c, tweetCount: 9 }] });
  mock.state.xOverlongRemaining = 0;
  assert.equal(r.status, 200, r.text);
  const counts = [1, 4, 9];
  r.json.threads.forEach((t, i) => {
    assert.equal(t.ok, true, JSON.stringify(t));
    assert.equal(t.tweets.length, counts[i]);
    t.tweets.forEach((tw) => assert.ok(xWeightedLength(tw) <= 280, `tweet over limit: ${xWeightedLength(tw)}`));
    assert.deepEqual(t.warnings.filter((w) => w.startsWith('Validation')), []);
    const joined = t.tweets.join('\n');
    assert.ok([a, b, c][i].sources.some((s) => joined.includes(s.url)), 'source link inside the configured tweet count');
  });
  assert.ok(!r.json.threads[0].tweets[0].startsWith('xxxx'), 'overlong draft was repaired');
});

test('X: tweet count is validated', async () => {
  const [a] = pick();
  for (const tweetCount of [0, 26, 2.5, 'abc']) {
    const r = await call('POST', '/api/x', { ideas: [{ ...a, tweetCount }] });
    assert.equal(r.status, 400, String(tweetCount));
  }
});

test('hook review rewrites a failing opening (LinkedIn and X)', async () => {
  const [a] = pick();
  mock.state.reviewFail = true;
  try {
    const li = await call('POST', '/api/linkedin', { ideas: [a] });
    assert.ok(li.json.posts[0].hookRevised);
    assert.ok(li.json.posts[0].text.startsWith('Revised:'));
    assert.ok(li.json.posts[0].warnings.some((w) => /Opening rewritten/.test(w)));
    const x = await call('POST', '/api/x', { ideas: [{ ...a, tweetCount: 3 }] });
    assert.ok(x.json.threads[0].hookRevised);
    assert.ok(x.json.threads[0].tweets[0].startsWith('Revised:'));
  } finally { mock.state.reviewFail = false; }
});

test('one agent failing does not affect the other; errors are specific', async () => {
  const [a] = pick();
  mock.state.failOpenAI = (req) => req.response_format.json_schema.name === 'x_threads';
  const [li, x] = await Promise.all([
    call('POST', '/api/linkedin', { ideas: [a] }),
    call('POST', '/api/x', { ideas: [{ ...a, tweetCount: 3 }] }),
  ]);
  mock.state.failOpenAI = null;
  assert.equal(li.status, 200);
  assert.equal(li.json.posts[0].ok, true);
  assert.equal(x.status, 502);
  assert.equal(x.json.error.code, 'UPSTREAM_ERROR');
  // and X can be retried independently afterwards
  const retry = await call('POST', '/api/x', { ideas: [{ ...a, tweetCount: 3 }] });
  assert.equal(retry.json.threads[0].ok, true);
});

test('rate limits surface as RATE_LIMITED with retry-after', async () => {
  const saved = cookie;
  cookie = '';
  await call('PUT', '/api/session', { openaiKey: 'sk-ratelimit-key-000000' });
  const [a] = pick();
  const r = await call('POST', '/api/linkedin', { ideas: [a] });
  assert.equal(r.status, 429);
  assert.equal(r.json.error.code, 'RATE_LIMITED');
  assert.equal(r.json.error.retryAfter, 12);
  cookie = saved;
});

test('search failures: quota and invalid key are reported as such', async () => {
  const saved = cookie;
  cookie = '';
  await call('PUT', '/api/session', { openaiKey: OPENAI_KEY, serpapiKey: 'serp-ratelimit-key-000000' });
  const r = await call('POST', '/api/research', { windowStart: new Date(Date.now() - 86_400_000).toISOString() });
  assert.equal(r.status, 429);
  assert.equal(r.json.error.code, 'SERPAPI_QUOTA');
  cookie = saved;
});

test('clearing the session removes the keys', async () => {
  const r = await call('DELETE', '/api/session');
  assert.deepEqual(r.json.configured, { openai: false, serpapi: false });
  const after = await call('POST', '/api/linkedin', { ideas: [] });
  assert.equal(after.status, 401);
});

test('server logs never contain credentials', () => {
  const all = logs.join('\n');
  assert.ok(all.includes('POST /api/research'), 'requests are logged');
  for (const secret of [OPENAI_KEY, SERP_KEY, 'SECRET', 'INVALIDKEY']) assert.ok(!all.includes(secret), `log leaked ${secret}`);
});
