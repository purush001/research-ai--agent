import { chatJSON } from '../llm.js';
import { ideaBrief, GROUNDING_RULE, today } from './shared.js';

export const MAX_TWEET = 280;

const system = (count) => `You are the X/Twitter Agent on a content team. Today is ${today()}.
Audience: developers and builders at tech startups in San Francisco and the Bay Area — fast-moving, practical,
allergic to corporate fluff. They care about what shipped, what it costs, what breaks, and what they can build with it.
Write a thread of EXACTLY ${count} tweets.
Style:
- Tweet 1 is the hook: a bold, specific claim or surprising fact that earns the click. Say what the thread covers.
- Number every tweet like "1/${count}" at the start.
- One idea per tweet. Concrete over abstract: tools, numbers from the sources, tradeoffs, small examples.
- Plain, punchy, conversational; dry humour is fine. No hashtag spam (at most one, in the last tweet), no emoji walls.
- The last tweet wraps up with the key takeaway and a light ask to follow/repost.
- Every tweet MUST be ${MAX_TWEET} characters or fewer, including the numbering.
${GROUNDING_RULE}
Return JSON: {"tweets": [string, ...]} with exactly ${count} strings.`;

function check(tweets, count) {
  const issues = [];
  if (tweets.length !== count) issues.push(`You returned ${tweets.length} tweets but exactly ${count} are required.`);
  tweets.forEach((t, i) => {
    if (t.length > MAX_TWEET) issues.push(`Tweet ${i + 1} is ${t.length} characters; the limit is ${MAX_TWEET}.`);
  });
  return issues;
}

export async function writeThread({ settings, idea, count }) {
  const messages = [
    { role: 'system', content: system(count) },
    { role: 'user', content: `Write an X thread for this idea.\n\n${ideaBrief(idea)}` },
  ];

  let tweets = [];
  let issues = [];
  // Up to 3 attempts; each failed attempt feeds the exact problems back to the model.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, text } = await chatJSON({ settings, messages });
    tweets = (Array.isArray(data.tweets) ? data.tweets : []).map((t) => String(t).trim()).filter(Boolean);
    issues = check(tweets, count);
    if (!issues.length) break;
    messages.push(
      { role: 'assistant', content: text },
      { role: 'user', content: `Fix these problems and return the complete thread again as JSON:\n- ${issues.join('\n- ')}` },
    );
  }

  if (!tweets.length) throw new Error('The X Agent returned an empty thread.');
  return { tweets, warnings: issues };
}
