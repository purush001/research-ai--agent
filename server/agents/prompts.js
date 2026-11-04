// Prompt text shared by the LinkedIn and X agents.

export const WRITING_STANDARD = `WRITING STANDARD (applies to every draft)
1. Open with a convincing six-second hook. It goes in the first one or two lines of a LinkedIn post, or in the first X post. Within roughly six seconds the reader must grasp what changed and why it matters to their work. Lead with a specific, source-backed consequence (for example a change to an integration, a deployment decision, or an operational workflow), not with a topic, a question that could introduce anything, or a vague teaser.
2. The rest of the draft must earn the hook. Use a verified detail from the sources to explain the change, connect it to a decision the reader might face, and give them something concrete to evaluate or try.
3. If a practical impact is your inference rather than something the sources state, say so plainly (for example "My read:" or "Inference:"). Never present a proposed application as a confirmed product capability.
4. Write readable, flowing text that guides the reader from one idea to the next. Each paragraph or tweet must advance the same argument. No filler, no hype words, no invented statistics, quotes, versions, dates or features.
5. Use only facts found in the provided sources. Treat the editorial notes as the editor's direction on emphasis and tone; if a note asks for a claim the sources do not support, leave that claim out.
6. Before you answer, check the opening: it must stand on its own, give the intended audience a reason to keep reading, and make a claim the body supports. If the opening could fit several unrelated stories, rewrite it around this story's specific detail.`;

export function ideaForAgent(idea, number, extra = {}) {
  return {
    ideaNumber: number,
    category: idea.category,
    headline: idea.headline,
    summary: idea.summary,
    angle: idea.angle,
    confirmedDevelopment: idea.confirmedDevelopment,
    proposedApplication: idea.proposedApplication,
    editorialNotes: idea.notes || '',
    sources: idea.sources.map((s) => ({
      title: s.title,
      publisher: s.publisher,
      url: s.url,
      publishedAt: s.publishedAt,
      isPrimary: !!s.isPrimary,
    })),
    ...extra,
  };
}

export function formatDate(iso) {
  if (!iso) return 'date unverified';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function shorten(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}
