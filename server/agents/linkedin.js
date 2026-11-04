import { chatJson } from '../providers/openai.js';
import { LINKEDIN_LIMIT } from '../../shared/constants.js';
import { extractUrls } from '../../shared/xlength.js';
import { WRITING_STANDARD, formatDate, ideaForAgent, shorten } from './prompts.js';
import { runDraftingAgent } from './runner.js';

export { LINKEDIN_LIMIT };
const HOOK_MAX_CHARS = 220;
const MAX_ATTEMPTS = 3;
const AUDIENCE = 'technical professionals with 10–20 years of experience (DBAs, architects, integration and ERP developers, engineering leads) who are new to agentic AI';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['posts'],
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ideaNumber', 'hook', 'body', 'ctaLine'],
        properties: {
          ideaNumber: { type: 'integer' },
          hook: { type: 'string' },
          body: { type: 'string' },
          ctaLine: { type: 'string' },
        },
      },
    },
  },
};

const SYSTEM = `You are the LinkedIn Agent. You write one standalone LinkedIn post per approved idea for ${AUDIENCE}. They are experts in their own field but may not know agentic AI vocabulary.

${WRITING_STANDARD}

LinkedIn specifics
- Voice: first person, plain and direct, respectful of the reader's experience. No hype words, no emoji decoration, at most 3 hashtags and only at the very end of the body.
- Plain text only (LinkedIn does not render markdown). Short paragraphs separated by blank lines. No headings, no asterisks.
- Explain unfamiliar terms as they arise, in a clause, using concepts the reader already knows (batch jobs, message queues, transactions, patch cycles). Examples of terms to explain: agentic AI, tool calling, MCP, RAG, vector search, guardrails.
- When the sources support a connection to Oracle or PeopleSoft, name the affected workflow (for example an Integration Broker message flow, a PeopleTools upgrade, SQL tuning, patching, a nightly batch) and explain the practical implication. If that connection is your inference, label it. Do not stretch a connection the sources do not support.
- "hook": the first one or two lines of the post (at most ${HOOK_MAX_CHARS} characters total, separated by a single newline if two lines).
- "body": everything after the hook, 800 to 2,000 characters. Do not repeat the hook.
- Do NOT write any URLs, a "Sources" list, or a call to action in hook or body. Source links and the call-to-action URL are appended automatically. You may say "sources are linked below".
- "ctaLine": ONLY when ctaUrl is provided for an idea: one short, relevant call-to-action sentence that ends right before the link (for example "If you are planning this upgrade, here is the checklist I use:"). It must not contain a URL. Use an empty string when ctaUrl is empty.`;

function sourcesBlock(sources) {
  const lines = sources.map((s) => {
    const meta = [s.publisher, formatDate(s.publishedAt)].filter(Boolean).join(', ');
    return `• ${shorten(s.title, 90)} (${meta})\n${s.url}`;
  });
  return `Sources:\n${lines.join('\n')}`;
}

export function assemblePost({ hook, body, ctaLine }, sources, ctaUrl) {
  const parts = [hook.trim(), body.trim(), sourcesBlock(sources)];
  if (ctaUrl) parts.push(`${ctaLine.trim()}\n${ctaUrl}`);
  return parts.join('\n\n');
}

export function validatePost(draft, idea) {
  const issues = [];
  const add = (code, message) => issues.push({ code, message });
  const hook = (draft.hook || '').trim();
  const body = (draft.body || '').trim();
  if (!hook) add('hook_empty', 'hook is empty');
  if (hook.split('\n').filter(Boolean).length > 2) add('hook_lines', 'hook must be at most two lines');
  if (hook.length > HOOK_MAX_CHARS) add('hook_long', `hook is ${hook.length} characters; keep it under ${HOOK_MAX_CHARS}`);
  if (body.length < 400) add('body_short', 'body is too short to earn the hook');
  if (extractUrls(`${hook}\n${body}\n${draft.ctaLine || ''}`).length) add('url_in_text', 'do not write URLs or domain names; links are added automatically');
  if (idea.ctaUrl && !(draft.ctaLine || '').trim()) add('cta_missing', 'ctaLine is required because a CTA URL was provided');
  const text = assemblePost({ hook, body, ctaLine: draft.ctaLine || '' }, idea.sources, idea.ctaUrl);
  if (text.length > LINKEDIN_LIMIT) add('post_too_long', `full post is ${text.length} characters; LinkedIn allows ${LINKEDIN_LIMIT}. Shorten the body`);
  return { issues, problems: issues.map((i) => i.message), text, hook, body };
}

/**
 * Generates one post per idea. Always resolves: every idea gets either a draft
 * (possibly with warnings) or an error, so one bad draft never loses the rest.
 * `ideas` are 1-3 approved ideas: { id, ..., sources, notes, ctaUrl }.
 */
export function runLinkedIn(session, ideas) {
  return runDraftingAgent(session, ideas, {
    platform: 'linkedin',
    noun: 'post',
    audience: AUDIENCE,
    openingRules: `The opening is the first one or two lines (at most ${HOOK_MAX_CHARS} characters), plain text, no URLs.`,
    maxAttempts: MAX_ATTEMPTS,
    countFor: () => undefined,
    async generate(sess, pending, attempt) {
      return chatJson(sess, {
        system: SYSTEM,
        user: {
          task: attempt === 1 ? 'Write one LinkedIn post for each idea.' : 'Some drafts failed validation. Rewrite ONLY the ideas listed, fixing every listed problem.',
          ideas: pending.map((p) =>
            ideaForAgent(p.idea, p.number, {
              ctaUrl: p.idea.ctaUrl || '',
              ...(p.feedback ? { previousDraft: p.previous, problemsToFix: p.feedback } : {}),
            }),
          ),
        },
        schemaName: 'linkedin_posts',
        schema: SCHEMA,
        maxTokens: 10_000,
      });
    },
    draftFor: (out, number) => (out.posts || []).find((p) => p.ideaNumber === number),
    usable: () => true,
    validate: (draft, idea) => validatePost(draft, idea).issues,
    describe: (draft) => draft,
    reviewItem: (idea, number, draft) => ({
      ideaNumber: number,
      storyHeadline: idea.headline,
      confirmedDevelopment: idea.confirmedDevelopment,
      opening: draft.hook,
      restOfPost: draft.body,
    }),
    withOpening: (draft, opening) => ({ ...draft, hook: opening }),
    result(idea, draft, warnings, hookRevised) {
      const v = validatePost(draft, idea);
      return { ideaId: idea.id, ok: true, text: v.text, hook: v.hook, warnings, hookRevised };
    },
  });
}
