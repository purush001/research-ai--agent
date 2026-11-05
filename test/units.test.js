import test from 'node:test';
import assert from 'node:assert/strict';
import { X_LIMIT, extractUrls, validateTweet, xWeightedLength } from '../shared/xlength.js';
import { inWindow, normalizeUrl, parseArticleDate, recencyFilter } from '../server/agents/dates.js';
import { assembleIdeas, missingCounts, selectCandidates } from '../server/agents/research.js';
import { assemblePost, validatePost } from '../server/agents/linkedin.js';
import { requiredLinksFor, validateThread } from '../server/agents/x.js';
import { redact } from '../server/redact.js';

test('X length: plain text counts 1 per character', () => {
  assert.equal(xWeightedLength('hello world'), 11);
  assert.equal(xWeightedLength('a'.repeat(280)), 280);
  assert.equal(validateTweet('a'.repeat(280)).valid, true);
  assert.equal(validateTweet('a'.repeat(281)).valid, false);
  assert.equal(validateTweet('a'.repeat(285)).over, 5);
});

test('X length: every URL counts 23 regardless of length', () => {
  const long = 'https://example.com/' + 'x'.repeat(200);
  assert.equal(xWeightedLength(long), 23);
  assert.equal(xWeightedLength(`See ${long}`), 4 + 23);
  assert.equal(xWeightedLength(`See ${long}.`), 4 + 23 + 1, 'trailing period is not part of the URL');
  assert.deepEqual(extractUrls(`a ${long}, b https://x.dev/y)`), [long, 'https://x.dev/y']);
});

test('X length: emoji and CJK count 2, accented Latin counts 1', () => {
  assert.equal(xWeightedLength('🚀'), 2);
  assert.equal(xWeightedLength('👩‍💻'), 2, 'ZWJ sequence is one emoji');
  assert.equal(xWeightedLength('日本'), 4);
  assert.equal(xWeightedLength('café'), 4);
  assert.equal(xWeightedLength('a\nb'), 3);
});

test('X length: the 280 boundary uses weighted length with URLs', () => {
  const url = 'https://example.com/a/very/long/path/that/would/exceed/the/limit/on/its/own';
  const text = 'a'.repeat(280 - 23 - 1) + ' ' + url;
  assert.equal(xWeightedLength(text), 280);
  assert.equal(validateTweet(text).valid, true);
  assert.equal(validateTweet('x' + text).valid, false);
  assert.equal(validateTweet('   ').valid, false, 'blank tweets are invalid');
});

test('dates: relative, absolute and ISO forms', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  assert.deepEqual(parseArticleDate({ date: '3 hours ago' }, now), { iso: '2026-11-04T09:00:00.000Z', precision: 'time' });
  assert.equal(parseArticleDate({ date: '2 days ago' }, now).precision, 'day');
  assert.equal(parseArticleDate({ iso_date: '2026-11-03T08:00:00Z' }, now).iso, '2026-11-03T08:00:00.000Z');
  assert.equal(parseArticleDate({ date: 'Nov 3, 2026' }, now).precision, 'day');
  assert.equal(parseArticleDate({ date: 'not a date' }, now).iso, null);
  assert.equal(parseArticleDate({}, now).iso, null);
});

test('dates: window check is exact for timestamps and day-level for date-only', () => {
  const end = new Date('2026-11-04T12:00:00Z');
  const start = new Date('2026-11-03T12:00:00Z');
  assert.equal(inWindow({ iso: '2026-11-03T11:59:00Z', precision: 'time' }, start, end), false);
  assert.equal(inWindow({ iso: '2026-11-03T12:01:00Z', precision: 'time' }, start, end), true);
  assert.equal(inWindow({ iso: '2026-11-03T00:00:00Z', precision: 'day' }, start, end), true, 'same calendar day as start');
  assert.equal(inWindow({ iso: '2026-11-02T00:00:00Z', precision: 'day' }, start, end), false);
  assert.equal(inWindow({ iso: null, precision: null }, start, end), false, 'unknown dates are never verified');
  assert.equal(recencyFilter(start, end), 'qdr:d');
  assert.equal(recencyFilter(new Date('2026-10-28T12:00:00Z'), end), 'qdr:w');
});

test('normalizeUrl strips tracking and www', () => {
  assert.equal(normalizeUrl('https://www.Example.com/a/?utm_source=x&id=1#frag'), 'https://example.com/a?id=1');
});

const cand = (id, over = {}) => ({
  id, title: `Story ${id}`, publisher: 'P', url: `https://example.com/${id}`, publishedAt: '2026-11-04T01:00:00.000Z',
  datePrecision: 'time', isPrimary: id % 2 === 0, ...over,
});
const idea = (category, headline, sourceIds) => ({ category, headline, summary: 's', angle: 'a', confirmedDevelopment: 'c', proposedApplication: 'p', sourceIds });

test('assembleIdeas enforces quotas, maps sources and drops repeats', () => {
  const candidates = Array.from({ length: 12 }, (_, i) => cand(i + 1));
  const needs = { oracle: 2, peoplesoft: 2, general: 6 };
  const model = [
    idea('oracle', 'O1', [1]), idea('oracle', 'O2', [2]), idea('oracle', 'O3 over quota', [3]),
    idea('peoplesoft', 'P1', [4]),
    idea('general', 'G1', [5]), idea('general', 'G1 again same article', [5]), // same source -> duplicate story
    idea('general', 'G2', [99]), // unknown source id -> no verified source
    idea('general', 'G3', [6, 7]),
  ];
  const { ideas, dropped } = assembleIdeas(model, candidates, { needs });
  assert.deepEqual(ideas.map((i) => i.headline), ['O1', 'O2', 'P1', 'G1', 'G3']);
  assert.equal(dropped.length, 3);
  assert.ok(dropped.some((d) => d.reason === 'category already full'));
  assert.ok(dropped.some((d) => d.reason === 'duplicate story'));
  assert.ok(dropped.some((d) => /verified publication date/.test(d.reason)));
  const g3 = ideas.find((i) => i.headline === 'G3');
  assert.equal(g3.sources.length, 2);
  assert.equal(g3.sources[0].isPrimary, true, 'primary sources are listed first');
  assert.deepEqual(missingCounts(ideas), { oracle: 0, peoplesoft: 1, general: 4 });
});

test('assembleIdeas does not repeat a story already kept (widen runs)', () => {
  const candidates = [cand(1), cand(2)];
  const existing = [{ headline: 'Kept', category: 'oracle', sources: [{ url: 'https://example.com/1' }] }];
  const { ideas } = assembleIdeas([idea('oracle', 'Same story, new words', [1]), idea('oracle', 'New', [2])], candidates, { needs: { oracle: 1, peoplesoft: 0, general: 0 }, existing });
  assert.deepEqual(ideas.map((i) => i.headline), ['New']);
});

const sources = [
  { title: 'A', publisher: 'Pub', url: 'https://example.com/a', publishedAt: '2026-11-04T01:00:00.000Z' },
  { title: 'B', publisher: 'Pub2', url: 'https://example.com/b', publishedAt: '2026-11-03T01:00:00.000Z' },
];

test('LinkedIn post: sources always included, CTA URL last on its own line, blank means no CTA', () => {
  const draft = { hook: 'Hook line', body: 'Body.', ctaLine: 'Read the checklist:' };
  const withCta = assemblePost(draft, sources, 'https://me.dev/guide');
  assert.ok(withCta.includes('https://example.com/a') && withCta.includes('https://example.com/b'));
  assert.ok(withCta.endsWith('Read the checklist:\nhttps://me.dev/guide'));
  const without = assemblePost(draft, sources, '');
  assert.ok(!without.includes('me.dev') && !without.includes('Read the checklist'));
  assert.ok(without.endsWith('https://example.com/b'));
});

test('LinkedIn validation flags URLs in prose, long hooks, missing CTA line', () => {
  const body = 'word '.repeat(120);
  const idea_ = { sources, ctaUrl: 'https://me.dev' };
  assert.ok(validatePost({ hook: 'ok', body, ctaLine: '' }, idea_).problems.some((p) => /ctaLine/.test(p)));
  assert.ok(validatePost({ hook: 'ok https://x.dev', body, ctaLine: 'cta' }, idea_).problems.some((p) => /URL/.test(p)));
  assert.ok(validatePost({ hook: 'h'.repeat(300), body, ctaLine: 'cta' }, idea_).problems.some((p) => /hook is 300/.test(p)));
  assert.deepEqual(validatePost({ hook: 'Good hook', body, ctaLine: 'cta' }, idea_).problems, []);
});

test('X thread validation: exact count, per-tweet limit, required links, unknown URLs', () => {
  const idea_ = { sources };
  const msgs = (tweets, n) => validateThread(tweets, idea_, n).map((i) => i.message);
  const ok = ['Hook', 'Mid', `Read https://example.com/a and https://example.com/b`];
  assert.deepEqual(validateThread(ok, idea_, 3), []);
  assert.ok(msgs(ok, 4)[0].includes('exactly 4'));
  assert.ok(msgs([...ok.slice(0, 2), 'x'.repeat(300) + ' https://example.com/a https://example.com/b'], 3).some((p) => /tweet 3 is/.test(p)));
  assert.ok(msgs(['Hook', 'Mid', 'https://example.com/a'], 3).some((p) => /required link missing/.test(p)));
  assert.ok(msgs(['Hook', 'Mid', 'https://example.com/a https://example.com/b https://evil.dev/z'], 3).some((p) => /unknown URL/.test(p)));
  assert.ok(msgs(['Hook', 'Mid', 'https://example.com/a https://example.com/b and also oracle.com/docs'], 3).some((p) => /oracle\.com\/docs/.test(p)), 'bare domains are rejected');
  assert.equal(requiredLinksFor(idea_, 1).length, 1);
  assert.equal(X_LIMIT, 280);
  // issues carry stable codes
  assert.deepEqual(validateThread(['x'.repeat(300), 'b', 'c'], idea_, 3).map((i) => i.code).slice(0, 1), ['too_long:1']);
});

test('X length: scheme-less domains count as 23 like X does; look-alikes do not', () => {
  assert.equal(xWeightedLength('see blogs.oracle.com/peoplesoft/new-release-notes-for-the-latest-update now'), 4 + 23 + 4);
  assert.equal(xWeightedLength('Oracle.com.'), 24, 'trailing period is outside the link');
  assert.equal(xWeightedLength('Node.js v8.62 e.g. fine'), 23, 'not links');
  assert.equal(xWeightedLength('mail me@oracle.com'), 18, 'emails are not links');
  assert.equal(xWeightedLength('© ® ™'), 1 + 1 + 1 + 1 + 2, 'copyright/registered stay 1-weight; trademark sign is weight 2');
});

test('candidate cap is balanced across categories', () => {
  const mk = (n, cats, primary) => ({ id: n, url: `https://e.com/${n}`, publishedAt: new Date(Date.now() - n * 60_000).toISOString(), isPrimary: primary, categories: new Set(cats) });
  // 120 primary general articles would crowd out 10 non-primary PeopleSoft ones under a plain global sort
  const general = Array.from({ length: 120 }, (_, i) => mk(i, ['general'], true));
  const ps = Array.from({ length: 10 }, (_, i) => mk(1000 + i, ['peoplesoft'], false));
  const picked = selectCandidates([...general, ...ps], ['oracle', 'peoplesoft', 'general'], 90);
  assert.equal(picked.length, 90);
  assert.equal(picked.filter((c) => c.categories.has('peoplesoft')).length, 10);
  assert.equal(new Set(picked).size, 90, 'no duplicates when an article belongs to several categories');
});

test('LinkedIn validation exposes stable issue codes', () => {
  const v = validatePost({ hook: 'h'.repeat(300), body: 'x'.repeat(3100), ctaLine: '' }, { sources, ctaUrl: 'https://me.dev' });
  assert.deepEqual(v.issues.map((i) => i.code).sort(), ['cta_missing', 'hook_long', 'post_too_long']);
});

test('redact leaves ordinary words alone', () => {
  assert.equal(redact('The CTA URL for "Risk-based patching" is invalid', []), 'The CTA URL for "Risk-based patching" is invalid');
  assert.ok(!redact('key sk-abcdef123456', []).includes('abcdef'));
});

test('redact removes keys even when a provider echoes them', () => {
  const key = 'sk-proj-ABCDEF1234567890';
  assert.ok(!redact(`Incorrect API key provided: ${key}.`, [key]).includes('ABCDEF'));
  assert.ok(!redact('Incorrect API key provided: sk-proj-ABCD****7890', []).includes('ABCD'));
  assert.ok(!redact('GET /search.json?q=a&api_key=abcdef0123456789abcdef0123456789abcdef0123456789', []).includes('abcdef01'));
});
