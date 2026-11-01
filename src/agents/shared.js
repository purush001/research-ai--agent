export const today = () => new Date().toISOString().slice(0, 10);

// Compact, source-grounded description of an idea for the writer agents.
export function ideaBrief(idea) {
  const sources = (idea.sources || [])
    .map((s, i) => `  ${i + 1}. ${s.title} (${s.source || 'unknown'}, ${s.date || 'recent'}) — ${s.snippet || ''}`)
    .join('\n');
  return [
    `TITLE: ${idea.title}`,
    `ANGLE: ${idea.angle}`,
    `WHY IT MATTERS NOW: ${idea.whyNow}`,
    `SOURCE ARTICLES:\n${sources || '  (none)'}`,
  ].join('\n');
}

export const GROUNDING_RULE =
  'Ground every factual claim in the source articles provided. Never invent statistics, quotes, product names or dates. ' +
  'If the sources are thin, speak to the trend and your informed perspective rather than fabricating specifics.';
