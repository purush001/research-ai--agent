import { config } from '../config.js';
import { AppError } from '../errors.js';
import { redact } from '../redact.js';
import { providerFetch, readBodySafely, retryAfterSeconds } from './http.js';

const PROVIDER = 'OpenAI';

function mapOpenAIError(status, json, res, key) {
  const err = json?.error || {};
  const msg = redact(err.message || '', [key]);
  const code = err.code || err.type || '';

  if (status === 401) {
    return new AppError('INVALID_OPENAI_KEY', 'OpenAI rejected the API key (401).', {
      status: 401,
      provider: PROVIDER,
      hint: 'Open Settings and enter a valid OpenAI API key.',
    });
  }
  if (status === 403) {
    return new AppError('OPENAI_FORBIDDEN', `OpenAI denied access (403)${msg ? `: ${msg}` : ''}.`, {
      status: 403,
      provider: PROVIDER,
      hint: 'Your key or organization may not have access to this model or region.',
    });
  }
  if (status === 404 && /model/i.test(`${code} ${msg}`)) {
    return new AppError('MODEL_NOT_AVAILABLE', `The model "${config.model}" is not available to this API key.`, {
      status: 404,
      provider: PROVIDER,
      hint: 'Ask OpenAI for access, or set OPENAI_MODEL on the server to a model you can use.',
    });
  }
  if (status === 429) {
    if (code === 'insufficient_quota') {
      return new AppError('OPENAI_QUOTA', 'Your OpenAI account is out of quota or credits.', {
        status: 429,
        provider: PROVIDER,
        hint: 'Check billing and usage limits in the OpenAI dashboard.',
      });
    }
    return new AppError('RATE_LIMITED', 'OpenAI rate limit reached. Wait a moment and retry.', {
      status: 429,
      provider: PROVIDER,
      retryAfter: retryAfterSeconds(res),
      hint: 'Retrying immediately usually fails; wait for the suggested time.',
    });
  }
  if (status >= 500) {
    return new AppError('UPSTREAM_ERROR', `OpenAI had a server error (${status}).`, {
      status: 502,
      provider: PROVIDER,
      hint: 'This is usually temporary. Retry in a minute.',
    });
  }
  return new AppError('OPENAI_ERROR', `OpenAI returned an error (${status})${msg ? `: ${msg}` : ''}.`, {
    status: 502,
    provider: PROVIDER,
  });
}

/** Cheap key check that doesn't generate anything. Also reports model access. */
export async function checkOpenAIKey(key) {
  const res = await providerFetch(
    `${config.openaiBaseUrl}/models/${encodeURIComponent(config.model)}`,
    { headers: { authorization: `Bearer ${key}` } },
    { provider: PROVIDER, timeoutMs: 20_000, secrets: [key] },
  );
  const { json } = await readBodySafely(res);
  if (res.status === 404) return { valid: true, modelAvailable: false };
  if (!res.ok) throw mapOpenAIError(res.status, json, res, key);
  return { valid: true, modelAvailable: true };
}

/**
 * Ask the model for JSON that matches `schema` (Structured Outputs). Returns the
 * parsed object. `session.openaiKey` is only ever placed in the auth header.
 */
export async function chatJson(session, { system, user, schemaName, schema, maxTokens = 16_000 }) {
  const key = session.openaiKey;
  const res = await providerFetch(
    `${config.openaiBaseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: typeof user === 'string' ? user : JSON.stringify(user) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: schemaName, strict: true, schema },
        },
        max_completion_tokens: maxTokens,
      }),
    },
    { provider: PROVIDER, timeoutMs: config.openaiTimeoutMs, secrets: [key], retries: 0 },
  );
  const { json, text } = await readBodySafely(res);
  if (!res.ok) throw mapOpenAIError(res.status, json, res, key);

  const choice = json?.choices?.[0];
  if (choice?.message?.refusal) {
    throw new AppError('MODEL_REFUSED', 'The model declined this request.', { status: 502, provider: PROVIDER });
  }
  const content = choice?.message?.content;
  if (!content) {
    throw new AppError('BAD_MODEL_OUTPUT', 'The model returned an empty response.', {
      status: 502,
      provider: PROVIDER,
      hint: 'Retry. If it keeps happening the response may have hit the token limit.',
    });
  }
  try {
    return JSON.parse(content);
  } catch {
    const truncated = choice?.finish_reason === 'length';
    throw new AppError('BAD_MODEL_OUTPUT', truncated ? 'The model ran out of output tokens before finishing.' : 'The model returned malformed JSON.', {
      status: 502,
      provider: PROVIDER,
      hint: 'Retry. If this repeats, reduce the number of tweets or approved ideas.',
    });
  }
}
