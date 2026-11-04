// Server configuration. Everything here comes from the environment, never from
// the request, and none of it is a credential: API keys are entered in the UI.

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 8787),
  // All three agents use this model.
  model: process.env.OPENAI_MODEL || 'gpt-6.1-sol',
  openaiBaseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  serpapiBaseUrl: (process.env.SERPAPI_BASE_URL || 'https://serpapi.com').replace(/\/+$/, ''),
  openaiTimeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 240_000),
  serpapiTimeoutMs: Number(process.env.SERPAPI_TIMEOUT_MS || 25_000),
  sessionIdleMs: 8 * 60 * 60 * 1000,
  // Extra origins allowed to call the API (comma separated), e.g. a reverse proxy.
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  maxWindowDays: 30,
};
