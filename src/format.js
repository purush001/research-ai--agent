import { CATEGORIES, CATEGORY_LABELS, QUOTAS } from '../shared/constants.js';

export { CATEGORIES };
export const CATEGORY_META = Object.fromEntries(CATEGORIES.map((c) => [c, { label: CATEGORY_LABELS[c], quota: QUOTAS[c] }]));

export const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'date unverified';

export const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function fmtSpan(startIso, endIso) {
  const hours = (Date.parse(endIso) - Date.parse(startIso)) / 3_600_000;
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
