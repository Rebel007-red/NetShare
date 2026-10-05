import serverless from 'serverless-http';
import { createApp } from '../../server/app.js';

/**
 * The whole Express app runs inside one Netlify Function so the API has a
 * single implementation across local, Docker and Netlify deployments.
 *
 * `binary: true` base64-encodes every response body. Netlify decodes it back
 * before sending, and it is what keeps file downloads from being corrupted by
 * a UTF-8 round trip.
 */
const handle = serverless(createApp(), { binary: true, provider: 'aws' });

const FUNCTION_PREFIX = '/.netlify/functions/api';

/**
 * netlify.toml rewrites `/api/*` and `/s/*` onto this function. Express needs
 * the caller's original path, so prefer `rawUrl` (always the real request URL)
 * and fall back to undoing the rewrite prefix.
 */
function resolvePath(event) {
  if (event.rawUrl) {
    try {
      return new URL(event.rawUrl).pathname;
    } catch {
      // Fall through to the event path below.
    }
  }
  return event.path || '/';
}

function normalizePath(rawPath) {
  if (!rawPath.startsWith(FUNCTION_PREFIX)) return rawPath;

  const remainder = rawPath.slice(FUNCTION_PREFIX.length) || '/';
  // A direct hit on the function URL still needs to look like an app route.
  if (remainder === '/health') return '/api/health';
  if (remainder.startsWith('/s/')) return remainder;
  if (remainder.startsWith('/api/')) return remainder;
  return `/api${remainder === '/' ? '' : remainder}`;
}

export const handler = async (event, context) => {
  const path = normalizePath(resolvePath(event));
  return handle({ ...event, path }, context);
};
