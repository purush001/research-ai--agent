import { chatJSON } from '../llm.js';
import { searchNews } from '../search.js';
import { today, GROUNDING_RULE } from './shared.js';

const BASE_QUERIES = [
  'AI agents',
  'OpenAI OR Anthropic OR Google DeepMind announcement',
  'open source LLM release',
  'AI startup funding',
  'enterprise AI adoption',
  'AI regulation policy',
];

const SYSTEM = `You are the Research Agent on a content team. Today is ${today()}.
You read recent AI news articles and turn them into content ideas for a creator who posts on LinkedIn
(senior engineers/leaders with 10-20 years of experience, new to agentic AI) and on X (developers at SF startups).
${GROUNDING_RULE}
Return JSON: {"ideas":[{"title":string,"angle":string,"whyNow":string,"sources":[int]}]}
- Exactly 10 ideas, each clearly distinct, ranked best first.
- "title": a punchy working title (max 12 words).
- "angle": 1-2 sentences on the specific take/story the content would tell.
- "whyNow": 1 sentence on why this is timely.
- "sources": 1-3 article numbers from the list that support the idea.`;

export async function runResearch({ settings, focus, period, log }) {
  const queries = focus ? [focus, `${focus} news`, ...BASE_QUERIES.slice(0, 3)] : BASE_QUERIES;

  log(`Searching ${queries.length} queries on Google News…`);
  const results = await Promise.allSettled(
    queries.map(async (q) => {
      const items = await searchNews({ apiKey: settings.serpKey, q, period });
      log(`“${q}” → ${items.length} articles`);
      return items;
    }),
  );

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length === results.length) throw failures[0].reason;
  failures.forEach((f) => log(`A search failed: ${f.reason.message}`, 'warn'));

  const seen = new Set();
  const articles = results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .filter((a) => a.title && a.url && !seen.has(a.url) && seen.add(a.url))
    .slice(0, 40);

  if (articles.length < 3) throw new Error('Not enough news articles found. Try a broader focus or a longer time window.');

  log(`Reading ${articles.length} unique articles and drafting 10 ideas…`);
  const list = articles
    .map((a, i) => `[${i + 1}] ${a.title} — ${a.source || 'unknown'}, ${a.date || ''}\n    ${a.snippet}`)
    .join('\n');

  const { data } = await chatJSON({
    settings,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `${focus ? `Creator's focus area: ${focus}\n\n` : ''}ARTICLES:\n${list}` },
    ],
  });

  const ideas = (data.ideas || []).slice(0, 10).map((idea, i) => ({
    id: `idea-${i + 1}`,
    title: String(idea.title || '').trim(),
    angle: String(idea.angle || '').trim(),
    whyNow: String(idea.whyNow || '').trim(),
    sources: (Array.isArray(idea.sources) ? idea.sources : [])
      .map((n) => articles[Number(n) - 1])
      .filter(Boolean),
  })).filter((i) => i.title);

  if (ideas.length < 3) throw new Error('The model returned fewer than 3 usable ideas. Please run the agent again.');
  log(`Done — ${ideas.length} ideas ready for your review.`, 'ok');
  return ideas;
}
