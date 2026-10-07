import { RATE_LIMIT_ENABLED } from './config.js';
import { tooManyRequests } from './errors.js';

/**
 * A small fixed-window counter per key (normally the client IP).
 *
 * It lives in this process's memory. On a single Node server or Docker
 * container that is exact. On Netlify each function instance has its own
 * counters, so the effective limit is looser — good enough to stop casual
 * abuse and code guessing, not a substitute for edge rate limiting.
 */
export function createLimiter({ windowMs, max }) {
  const windows = new Map();

  function prune(now) {
    if (windows.size < 2000) return;
    for (const [key, entry] of windows) {
      if (now - entry.start >= windowMs) windows.delete(key);
    }
  }

  function entryFor(key, now) {
    const current = windows.get(key);
    if (current && now - current.start < windowMs) return current;
    const fresh = { start: now, count: 0 };
    windows.set(key, fresh);
    prune(now);
    return fresh;
  }

  return {
    /** Counts one hit; returns how long to wait if the key is now over the limit. */
    hit(key, now = Date.now()) {
      const entry = entryFor(key, now);
      entry.count += 1;
      return entry.count > max ? Math.ceil((entry.start + windowMs - now) / 1000) : 0;
    },

    /** Seconds until the key may try again, or 0 if it is under the limit. */
    blockedFor(key, now = Date.now()) {
      const entry = windows.get(key);
      if (!entry || now - entry.start >= windowMs) return 0;
      return entry.count >= max ? Math.ceil((entry.start + windowMs - now) / 1000) : 0;
    },

    reset() {
      windows.clear();
    },
  };
}

export function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** Middleware that counts every request against `limiter` and refuses the excess. */
export function limitRequests(limiter, message) {
  return (req, _res, next) => {
    if (!RATE_LIMIT_ENABLED) return next();
    const wait = limiter.hit(clientKey(req));
    if (wait > 0) return next(tooManyRequests(message, wait));
    return next();
  };
}
