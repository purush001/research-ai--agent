// X (Twitter) weighted-length counting, following the public twitter-text v3
// configuration: 280 max, every URL counts as 23, characters in the ranges
// U+0000-U+10FF, U+2000-U+200D, U+2010-U+201F and U+2032-U+2037 count as 1,
// and everything else (CJK, emoji, ...) counts as 2.
// This module is shared by the server (validation) and the UI (live counters).

export const X_LIMIT = 280;
export const X_URL_LENGTH = 23;

const SINGLE_WEIGHT_RANGES = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
];

// Matches http(s) URLs; trailing sentence punctuation is not part of the URL.
const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}]+$/;

const EMOJI_RE = /\p{Extended_Pictographic}/u;

const segmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter('en', { granularity: 'grapheme' })
    : null;

function codePointWeight(cp) {
  for (const [lo, hi] of SINGLE_WEIGHT_RANGES) {
    if (cp >= lo && cp <= hi) return 1;
  }
  return 2;
}

function plainTextWeight(text) {
  if (!text) return 0;
  const graphemes = segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
  let total = 0;
  for (const g of graphemes) {
    // An emoji (including ZWJ sequences, flags and skin-tone variants) counts as 2.
    if (EMOJI_RE.test(g)) {
      total += 2;
      continue;
    }
    for (const ch of g) total += codePointWeight(ch.codePointAt(0));
  }
  return total;
}

/** URLs found in the text, with trailing punctuation removed. */
export function extractUrls(text) {
  const urls = [];
  for (const m of String(text ?? '').matchAll(URL_RE)) {
    urls.push(m[0].replace(TRAILING_PUNCT_RE, ''));
  }
  return urls;
}

/** Weighted length of a post as X counts it. */
export function xWeightedLength(text) {
  const source = String(text ?? '').normalize('NFC');
  let total = 0;
  let cursor = 0;
  for (const m of source.matchAll(URL_RE)) {
    const url = m[0].replace(TRAILING_PUNCT_RE, '');
    total += plainTextWeight(source.slice(cursor, m.index));
    total += X_URL_LENGTH;
    cursor = m.index + url.length;
  }
  total += plainTextWeight(source.slice(cursor));
  return total;
}

export function validateTweet(text) {
  const length = xWeightedLength(text);
  const empty = String(text ?? '').trim().length === 0;
  return { length, valid: !empty && length <= X_LIMIT, empty, over: Math.max(0, length - X_LIMIT) };
}
