export class HttpError extends Error {
  /**
   * `code` is a stable machine-readable reason (for example `pin_required`)
   * that the client branches on, so it never has to match on message text.
   */
  constructor(statusCode, message, code) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function badRequest(message) {
  return new HttpError(400, message);
}

export function unauthorized(message, code) {
  return new HttpError(401, message, code);
}

export function notFound(message) {
  return new HttpError(404, message);
}

export function conflict(message) {
  return new HttpError(409, message);
}

export function payloadTooLarge(message) {
  return new HttpError(413, message);
}

export function tooManyRequests(message, retryAfterSeconds) {
  const error = new HttpError(429, message, 'rate_limited');
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}
