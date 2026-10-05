import express from 'express';
import { MAX_NOTE_BYTES, describeLimits } from './lib/config.js';
import { HttpError } from './lib/errors.js';
import { isValidSlug, normalizeSlug } from './lib/ids.js';
import { resolveForRedirect } from './lib/links.js';
import linksRouter from './routes/links.js';
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
  app.set('trust proxy', true);
  // Derived from the note ceiling so raising NETFILESHARE_MAX_NOTE_KB does not
  // start failing at the body parser instead of the validator.
  app.use(express.json({ limit: MAX_NOTE_BYTES + 64 * 1024 }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ...describeLimits() });
  });

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
    res.status(status).json({ message });
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
