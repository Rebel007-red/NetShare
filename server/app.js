import express from 'express';
import { accessKeyMatches, requireAccessKey } from './lib/access.js';
import {
  MAX_NOTE_BYTES,
  RATE_CREATE_PER_HOUR,
  RATE_LIMIT_ENABLED,
  RATE_MISS_PER_10_MIN,
  RATE_UPLOAD_PER_HOUR,
  TRUST_PROXY,
  describeLimits,
} from './lib/config.js';
import { HttpError, tooManyRequests, unauthorized } from './lib/errors.js';
import { clientKey, createLimiter, limitRequests } from './lib/rateLimit.js';
import { isValidSlug, normalizeSlug } from './lib/ids.js';
import { resolveForRedirect } from './lib/links.js';
import { mutateNoteRecord, noteKey, presentNote } from './lib/notes.js';
import { presentWorkspace, updateWorkspace, workspaceKey } from './lib/workspaces.js';
import linksRouter from './routes/links.js';
import { createPinSupport } from './routes/pin.js';
import notesRouter from './routes/notes.js';
import workspacesRouter from './routes/workspaces.js';

/**
 * Escapes text destined for the HTML fallback page. The target URL is
 * app-validated to http/https/mailto, but it is still user input.
 */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function redirectPage(targetUrl) {
  const safe = escapeHtml(targetUrl);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Redirecting</title>
<meta http-equiv="refresh" content="0;url=${safe}">
</head><body>Redirecting to <a href="${safe}">${safe}</a>.</body></html>`;
}

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', TRUST_PROXY);
  // Derived from the note ceiling so raising NETFILESHARE_MAX_NOTE_KB does not
  // start failing at the body parser instead of the validator. The multiplier
  // covers live-edit patches, which percent-encode newlines and non-ASCII text.
  app.use(express.json({ limit: MAX_NOTE_BYTES * 3 + 64 * 1024 }));

  // Counters are per app instance so tests (and the Netlify function) start clean.
  const createLimit = createLimiter({ windowMs: 60 * 60 * 1000, max: RATE_CREATE_PER_HOUR });
  const uploadLimit = createLimiter({ windowMs: 60 * 60 * 1000, max: RATE_UPLOAD_PER_HOUR });
  const missLimit = createLimiter({ windowMs: 10 * 60 * 1000, max: RATE_MISS_PER_10_MIN });

  /**
   * Share codes are the only access key, so guessing them is the attack. Every
   * failed lookup (404, wrong PIN, wrong passphrase) counts against the caller,
   * and once over the limit they are refused before any record is touched.
   */
  app.use(['/api/workspaces', '/api/notes', '/api/links', '/api/access', '/s'], (req, res, next) => {
    if (!RATE_LIMIT_ENABLED) return next();
    const key = clientKey(req);
    const wait = missLimit.blockedFor(key);
    if (wait > 0) return next(tooManyRequests('Too many failed attempts. Try again later.', wait));
    res.on('finish', () => {
      if (res.statusCode === 404 || res.locals.miss) missLimit.hit(key);
    });
    return next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ...describeLimits() });
  });

  app.post('/api/access', (req, res, next) => {
    if (accessKeyMatches(req.body?.key)) return res.status(204).end();
    res.locals.miss = true;
    return next(unauthorized('That passphrase is not right', 'access_required'));
  });

  // Creating things spends storage, so it is the part that is gated and limited.
  app.post(
    ['/api/workspaces', '/api/links', '/api/notes'],
    limitRequests(createLimit, 'Too many new items from this address. Try again later.'),
    requireAccessKey,
  );
  app.post(
    ['/api/workspaces/:code/files', '/api/workspaces/:code/folders'],
    limitRequests(uploadLimit, 'Too many uploads from this address. Try again later.'),
  );

  // Optional per-item PIN. The gate runs first so a locked item answers
  // pin_required before any route touches it.
  const workspacePin = createPinSupport({
    keyFor: workspaceKey,
    mutate: updateWorkspace,
    present: presentWorkspace,
    label: 'workspace',
  });
  const notePin = createPinSupport({
    keyFor: noteKey,
    mutate: mutateNoteRecord,
    present: presentNote,
    label: 'note',
  });
  app.use('/api/workspaces/:code', workspacePin.gate);
  app.use('/api/notes/:code', notePin.gate);
  app.use('/api/workspaces', workspacePin.router);
  app.use('/api/notes', notePin.router);

  app.use('/api/workspaces', workspacesRouter);
  app.use('/api/links', linksRouter);
  app.use('/api/notes', notesRouter);

  /**
   * Short-link redirect. 302 rather than 301 so the click counter keeps working
   * and a retargeted link is not cached in browsers forever.
   */
  app.get('/s/:slug', async (req, res, next) => {
    try {
      const slug = normalizeSlug(req.params.slug);
      if (!isValidSlug(slug)) {
        res.status(404).type('html').send(notFoundPage('That short link is not valid.'));
        return;
      }

      const link = await resolveForRedirect(slug);
      if (!link) {
        res.status(404).type('html').send(notFoundPage('That short link has expired or never existed.'));
        return;
      }

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.status(302).location(link.targetUrl).type('html').send(redirectPage(link.targetUrl));
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ message: 'Unknown API endpoint' });
  });

  app.use((error, _req, res, _next) => {
    const status = error instanceof HttpError ? error.statusCode : 500;
    const message = status >= 500 || !(error instanceof Error)
      ? 'Unexpected server error'
      : error.message;

    if (status >= 500) console.error('[netfileshare]', error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error?.retryAfterSeconds) res.setHeader('Retry-After', String(error.retryAfterSeconds));
    res.status(status).json({ message, ...(error instanceof HttpError && error.code ? { code: error.code } : {}) });
  });

  return app;
}

function notFoundPage(detail) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Link not found</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;
font-family:'Trebuchet MS','Segoe UI',sans-serif;color:#163035;
background:linear-gradient(180deg,#f7f3ea 0%,#eef3ef 100%)}
main{text-align:center;padding:32px;max-width:420px}
h1{margin:0 0 8px;font-size:22px}
p{margin:0 0 20px;color:#65767b}
a{display:inline-block;padding:10px 18px;border-radius:10px;
background:#116466;color:#fff;text-decoration:none}
</style></head>
<body><main><h1>Link not found</h1><p>${escapeHtml(detail)}</p>
<a href="/">Go to NetFileShare</a></main></body></html>`;
}
