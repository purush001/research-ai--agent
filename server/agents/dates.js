// Publication-date handling for news results. SerpAPI returns either an ISO
// timestamp, an absolute date ("Nov 3, 2026"), or a relative one ("3 hours ago").
// Each parsed date carries its precision so the window check is honest: a
// date-only value is accepted if its calendar day overlaps the window.

const UNIT_MS = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};

export function parseArticleDate(item, now = new Date()) {
  const iso = item?.iso_date || item?.published_at;
  if (iso) {
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) return { iso: new Date(t).toISOString(), precision: 'time' };
  }
  const raw = String(item?.date || '').trim();
  if (!raw) return { iso: null, precision: null };

  const rel = raw.match(/^(\d+)\s*(minute|hour|day|week|month)s?\s+ago$/i);
  if (rel) {
    const unit = rel[2].toLowerCase();
    const t = now.getTime() - Number(rel[1]) * UNIT_MS[unit];
    return { iso: new Date(t).toISOString(), precision: unit === 'minute' || unit === 'hour' ? 'time' : 'day' };
  }
  if (/^yesterday$/i.test(raw)) {
    return { iso: new Date(now.getTime() - UNIT_MS.day).toISOString(), precision: 'day' };
  }

  // "Nov 3, 2026, 08:15 AM, +0000 UTC" -> drop the trailing offset text.
  const cleaned = raw.replace(/,?\s*\+0000 UTC$/i, ' UTC');
  // V8's Date.parse is very lenient ("not a date, 2026" -> Jan 1), so only try
  // strings that look like a date: a month name, or a numeric y-m-d / m/d form.
  const looksLikeDate = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(cleaned) || /\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/.test(cleaned);
  if (!looksLikeDate) return { iso: null, precision: null };
  let t = Date.parse(cleaned);
  if (Number.isNaN(t) && !/\d{4}/.test(cleaned)) t = Date.parse(`${cleaned}, ${now.getUTCFullYear()} UTC`);
  if (Number.isNaN(t)) return { iso: null, precision: null };
  const hasTime = /\d{1,2}:\d{2}/.test(cleaned);
  return { iso: new Date(t).toISOString(), precision: hasTime ? 'time' : 'day' };
}

const dayStart = (ms) => Math.floor(ms / 86_400_000) * 86_400_000;

/** True only for a parsed date that falls inside [start, end]. Unknown dates are never "in window". */
export function inWindow(parsed, start, end) {
  if (!parsed?.iso) return false;
  const t = Date.parse(parsed.iso);
  const s = start.getTime();
  const e = end.getTime() + 5 * 60_000; // clock-skew slack
  if (parsed.precision === 'time') return t >= s && t <= e;
  // date-only: accept when that calendar day overlaps the window
  return dayStart(t) + 86_400_000 > s && dayStart(t) <= e;
}

/** Google's coarse recency filter for the window; exact filtering happens locally. */
export function recencyFilter(start, end) {
  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  if (hours <= 24) return 'qdr:d';
  if (hours <= 24 * 7) return 'qdr:w';
  return 'qdr:m';
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.replace(/^www\./, '');
    u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return String(url || '').toLowerCase();
  }
}

export function normalizeHeadline(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
