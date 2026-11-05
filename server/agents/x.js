import { chatJson } from '../providers/openai.js';
import { MAX_TWEETS, MIN_TWEETS } from '../../shared/constants.js';
import { X_LIMIT, extractUrls, validateTweet } from '../../shared/xlength.js';
import { normalizeUrl } from './dates.js';
import { WRITING_STANDARD, ideaForAgent } from './prompts.js';
import { runDraftingAgent } from './runner.js';

export { MAX_TWEETS, MIN_TWEETS };
const MAX_ATTEMPTS = 4;
const AUDIENCE = 'developers at tech startups in San Francisco and the Bay Area';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['threads'],
  properties: {
    threads: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ideaNumber', 'tweets'],
        properties: {
          ideaNumber: { type: 'integer' },
          tweets: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const SYSTEM = `You are the X Agent. You write one X (Twitter) thread per approved idea for ${AUDIENCE}. They ship fast, distrust hype, and value what they can run today.

${WRITING_STANDARD}

X specifics
- Build from the opening hook toward something developers can build, test, or learn: a small experiment, an eval to run, a failure mode to check, a design decision, a command or config to try. Make it concrete and specific to this story.
- Write EXACTLY tweetCount tweets for each idea: not one more, not one fewer. Tweet 1 is the hook and must stand on its own. A short thread must be dense, not padded; a long one must go deeper, not repeat.
- Each tweet is at most ${X_LIMIT} characters by X's counting rules: every URL counts as 23 characters no matter how long it is, most Latin text counts 1 per character, emoji and CJK count 2, and a line break counts 1.
- Plain text. No markdown, no "1/" numbering, at most one hashtag in the whole thread (optional).
- requiredLinks lists the supporting sources. Every one of them must appear in the thread as a full https:// URL copied exactly, inside a tweet that fits the limit (place each next to the fact it supports, or in the final tweet). Do not use any other URL. Never shorten URLs yourself, and never write a bare domain such as example.com (X would turn it into a link and count it as 23 characters).
- Separate confirmed facts from your own inference: label inference ("My read:", "Worth testing:").`;

/** The sources an X thread must carry (kept small so they fit the thread). */
export function requiredLinksFor(idea, tweetCount) {
  const max = tweetCount === 1 ? 1 : 3;
  const seen = new Set();
  const out = [];
  for (const s of idea.sources) {
    const key = normalizeUrl(s.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Returns structured issues ({ code, message }); an empty list means the thread is valid. */
export function validateThread(tweets, idea, tweetCount) {
  const issues = [];
  const add = (code, message) => issues.push({ code, message });
  if (!Array.isArray(tweets) || tweets.length !== tweetCount) {
    add('count', `must contain exactly ${tweetCount} tweets but has ${Array.isArray(tweets) ? tweets.length : 0}`);
    return issues;
  }
  tweets.forEach((t, i) => {
    const v = validateTweet(t);
    if (v.empty) add(`empty:${i + 1}`, `tweet ${i + 1} is empty`);
    else if (!v.valid) add(`too_long:${i + 1}`, `tweet ${i + 1} is ${v.length} characters by X's counting; remove at least ${v.over}`);
  });
  const allowed = new Set(idea.sources.map((s) => normalizeUrl(s.url)));
  const present = new Set();
  for (const t of tweets) {
    for (const u of extractUrls(t)) {
      if (allowed.has(normalizeUrl(u))) present.add(normalizeUrl(u));
      else add(`unknown_url:${u}`, `unknown URL or domain "${u}"; use only the provided source URLs, written as full https:// links`);
    }
  }
  for (const s of requiredLinksFor(idea, tweetCount)) {
    if (!present.has(normalizeUrl(s.url))) add(`missing_link:${s.url}`, `required link missing: ${s.url}`);
  }
  return issues;
}

/**
 * One thread per idea; `idea.tweetCount` sets that thread's length. Always
 * resolves with a result per idea so a failed thread never discards the others.
 */
export function runX(session, ideas) {
  return runDraftingAgent(session, ideas, {
    platform: 'x',
    noun: 'thread',
    audience: AUDIENCE,
    openingRules: `The opening is tweet 1: plain text, at most ${X_LIMIT} characters by X's counting (a URL counts as 23). Do not add a URL unless tweet 1 already has one.`,
    maxAttempts: MAX_ATTEMPTS,
    countFor: (idea) => idea.tweetCount,
    async generate(sess, pending, attempt) {
      return chatJson(sess, {
        system: SYSTEM,
        user: {
          task: attempt === 1 ? 'Write one thread for each idea.' : 'Some threads failed validation. Rewrite ONLY the threads listed, fixing every listed problem.',
          ideas: pending.map((p) =>
            ideaForAgent(p.idea, p.number, {
              tweetCount: p.count,
              requiredLinks: requiredLinksFor(p.idea, p.count).map((s) => s.url),
              ...(p.feedback ? { previousTweets: p.previous, problemsToFix: p.feedback } : {}),
            }),
          ),
        },
        schemaName: 'x_threads',
        schema: SCHEMA,
        maxTokens: 10_000,
      });
    },
    draftFor(out, number) {
      const thread = (out.threads || []).find((t) => t.ideaNumber === number);
      return thread ? { tweets: (thread.tweets || []).map((t) => String(t).trim()) } : undefined;
    },
    usable: (draft) => draft.tweets.length > 0,
    validate: (draft, idea, count) => validateThread(draft.tweets, idea, count),
    describe: (draft) => draft.tweets.map((t, i) => ({ tweet: i + 1, text: t, xLength: validateTweet(t).length })),
    reviewItem: (idea, number, draft) => ({
      ideaNumber: number,
      storyHeadline: idea.headline,
      confirmedDevelopment: idea.confirmedDevelopment,
      opening: draft.tweets[0],
      restOfThread: draft.tweets.slice(1),
    }),
    withOpening: (draft, opening) => ({ tweets: [opening, ...draft.tweets.slice(1)] }),
    result: (idea, draft, warnings, hookRevised) => ({ ideaId: idea.id, ok: true, tweets: draft.tweets, warnings, hookRevised }),
  });
}
