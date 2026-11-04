// Defence in depth: provider error bodies sometimes echo (part of) the key that
// was sent. Everything that leaves the server or reaches a log goes through here.

const KEY_PATTERNS = [
  /sk-[A-Za-z0-9_\-*.]{6,}/g, // OpenAI-style keys, full or partially masked
  /\b[a-f0-9]{48,64}\b/gi, // SerpAPI-style hex keys
  /(api[_-]?key=)[^&\s"']+/gi,
  /(bearer\s+)[A-Za-z0-9._\-]+/gi,
];

export function redact(input, secrets = []) {
  let text = typeof input === 'string' ? input : String(input ?? '');
  for (const secret of secrets) {
    if (secret && secret.length >= 6) text = text.split(secret).join('[redacted]');
  }
  for (const re of KEY_PATTERNS) {
    text = text.replace(re, (m, p1) => (p1 ? `${p1}[redacted]` : '[redacted]'));
  }
  return text;
}
