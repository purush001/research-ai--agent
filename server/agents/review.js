import { chatJson } from '../providers/openai.js';
import { WRITING_STANDARD } from './prompts.js';

// Independent second pass over every draft's opening. The generating call is
// told to self-check; this call checks again with fresh eyes and supplies a
// rewrite only when an opening fails.

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reviews'],
  properties: {
    reviews: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'ideaNumber',
          'standsAlone',
          'givesAudienceReasonToKeepReading',
          'bodySupportsClaim',
          'couldFitUnrelatedStories',
          'problem',
          'revisedOpening',
        ],
        properties: {
          ideaNumber: { type: 'integer' },
          standsAlone: { type: 'boolean' },
          givesAudienceReasonToKeepReading: { type: 'boolean' },
          bodySupportsClaim: { type: 'boolean' },
          couldFitUnrelatedStories: { type: 'boolean' },
          problem: { type: 'string' },
          revisedOpening: { type: 'string' },
        },
      },
    },
  },
};

export function openingPasses(r) {
  return r.standsAlone && r.givesAudienceReasonToKeepReading && r.bodySupportsClaim && !r.couldFitUnrelatedStories;
}

/**
 * @param items [{ ideaNumber, headline, sources, opening, rest }]
 * @param platform 'linkedin' | 'x'
 * Returns Map(ideaNumber -> review). Throws on provider errors; callers decide
 * whether to keep the drafts without the review.
 */
export async function reviewOpenings(session, { platform, audience, items, openingRules }) {
  const out = await chatJson(session, {
    system: `You are a strict editor reviewing the opening of ${platform === 'x' ? 'X threads' : 'LinkedIn posts'} for ${audience}.

${WRITING_STANDARD}

For each draft decide, honestly:
- standsAlone: someone reading ONLY the opening understands what changed and why it matters to their work within about six seconds.
- givesAudienceReasonToKeepReading: the intended audience has a concrete reason to continue.
- bodySupportsClaim: the rest of the draft actually backs up the claim the opening makes, using the story's sourced details.
- couldFitUnrelatedStories: the opening is generic enough to introduce several unrelated stories.
Put a one-sentence explanation in "problem" when anything fails (empty string if it all passes).
"revisedOpening": if any check fails, write a replacement opening that passes all four and that the existing body supports (do not add new facts). ${openingRules} If everything passes, return the original opening unchanged.`,
    user: { items },
    schemaName: 'opening_review',
    schema: REVIEW_SCHEMA,
    maxTokens: 6000,
  });
  return new Map((out.reviews || []).map((r) => [r.ideaNumber, r]));
}
