// Typed errors that are safe to show to the user. `code` is stable and is used
// by the UI to pick a hint; `message` never contains credentials.

export class AppError extends Error {
  constructor(code, message, { status = 500, provider, retryAfter, hint } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.provider = provider;
    this.retryAfter = retryAfter;
    this.hint = hint;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        provider: this.provider,
        retryAfter: this.retryAfter,
        hint: this.hint,
      },
    };
  }
}

export const isAppError = (e) => e instanceof AppError;
