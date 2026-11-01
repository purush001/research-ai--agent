const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Tolerate JSON wrapped in a code fence or surrounding prose.
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Model did not return valid JSON.');
  }
}

/**
 * Calls OpenAI Chat Completions in JSON mode.
 * `messages` is the full chat array so callers can do multi-turn repair loops.
 * Returns { data, text } — parsed JSON and the raw assistant text.
 */
export async function chatJSON({ settings, messages }) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.openaiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).error?.message || detail;
    } catch { /* ignore */ }
    throw new Error(`OpenAI ${res.status}: ${detail}`);
  }

  const body = await res.json();
  const text = body.choices?.[0]?.message?.content ?? '';
  return { data: parseJSON(text), text };
}
