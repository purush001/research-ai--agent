import { chatJSON } from '../llm.js';
import { ideaBrief, GROUNDING_RULE, today } from './shared.js';

const SYSTEM = `You are the LinkedIn Agent on a content team. Today is ${today()}.
Audience: experienced technologists with 10-20 years in the industry (engineers, architects, managers, directors).
They are technical and sharp, but are NOT yet deep into agentic AI — don't assume they know the jargon.
Style:
- Approachable and credible, first person, conversational. Respect their experience; never talk down.
- Hook in the first line (it is all that shows before "see more"). No clickbait, no "I'm thrilled to announce".
- Explain any AI/agent term in plain words, ideally by analogy to things they know from their career
  (microservices, batch jobs, ETL, workflow engines, APIs, on-call runbooks, etc.).
- Short paragraphs (1-3 lines) with blank lines between them. 150-250 words. At most 1-2 emojis.
- Include one concrete takeaway or "what this means for you" and end the body with a question that invites comments.
- Finish the post with 3-4 relevant hashtags on the last line.
${GROUNDING_RULE}
Return JSON: {"post": string, "cta": string}
"post" is the full post text (without any link). "cta" is one short, natural line (max 15 words) inviting the
reader to click a link below the post — do NOT include a URL in it.`;

export async function writeLinkedInPost({ settings, idea, ctaLink }) {
  const user = `Write a LinkedIn post for this idea.\n\n${ideaBrief(idea)}`;
  const { data } = await chatJSON({
    settings,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ],
  });

  const post = String(data.post || '').trim();
  if (!post) throw new Error('The LinkedIn Agent returned an empty post.');

  // The CTA link only appears when the user supplied one.
  if (!ctaLink) return { text: post };
  const cta = String(data.cta || 'Want to go deeper? Read more here:').trim();
  return { text: `${post}\n\n👉 ${cta} ${ctaLink}` };
}
