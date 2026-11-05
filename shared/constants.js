// Limits and category definitions used by both the server and the UI, so the
// two can never disagree about what is valid.

export const CATEGORIES = ['oracle', 'peoplesoft', 'general'];
export const QUOTAS = { oracle: 2, peoplesoft: 2, general: 6 };
export const CATEGORY_LABELS = { oracle: 'Oracle', peoplesoft: 'PeopleSoft', general: 'General AI news' };

export const LINKEDIN_LIMIT = 3000;
export const MIN_TWEETS = 1;
export const MAX_TWEETS = 25;
export const DEFAULT_TWEETS = 7;

export function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
