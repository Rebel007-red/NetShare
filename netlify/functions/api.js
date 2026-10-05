import http from 'node:http';
import { Readable } from 'node:stream';
import { createApp } from '../../server/app.js';

/**
 * The whole Express app runs inside one Netlify Function so the API has a
 * single implementation across local, Docker and Netlify deployments.
 *
 * This uses Netlify's current function format (a Request in, a Response out)
 * rather than the Lambda-compatible `(event, context)` one, because only the
 * current format receives the full Netlify Blobs credentials. The Lambda form
 * has no `uncachedEdgeURL`, which the store needs for strong consistency, so
 * every read-after-write would fail.
 *
 * Express wants a Node request, so the app listens on a private loopback port
 * and each incoming Request is forwarded to it. Responses are streamed back
 * untouched, so downloads stay byte-exact.
 *
 * The forwarding uses node:http rather than fetch on purpose. When Express
 * rejects an oversize upload it answers 413 and closes the socket while the
 * body is still being written; fetch reports that as an opaque "fetch failed",
 * whereas node:http still hands over the 413 response.
 */

let listening;

function getPort() {
  listening ??= new Promise((resolve, reject) => {
    const server = http.createServer(createApp());
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  return listening;
}

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade']);
const NO_BODY_STATUS = new Set([101, 204, 205, 304]);

function forward({ port, method, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const upstream = http.request({ host: '127.0.0.1', port, method, path, headers }, resolve);
    // After the response has arrived a late socket error is irrelevant: reject()
    // on an already-resolved promise is a no-op.
    upstream.on('error', reject);
    upstream.end(body);
  });
}

export default async (request) => {
  const port = await getPort();
  const url = new URL(request.url);

  const headers = Object.fromEntries(request.headers);
  for (const name of HOP_BY_HOP) delete headers[name];
  // Express builds absolute URLs (short links, redirects) from these.
  headers['x-forwarded-host'] = url.host;
  headers['x-forwarded-proto'] = url.protocol.replace(':', '');

  // Buffered, not streamed: Netlify caps request bodies near 6 MB.
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? Buffer.from(await request.arrayBuffer()) : undefined;
  if (body) headers['content-length'] = String(body.length);

  const upstream = await forward({
    port,
    method: request.method,
    path: `${url.pathname}${url.search}`,
    headers,
    body,
  });

  const responseHeaders = new Headers();
  for (let i = 0; i < upstream.rawHeaders.length; i += 2) {
    const name = upstream.rawHeaders[i];
    if (!HOP_BY_HOP.has(name.toLowerCase())) responseHeaders.append(name, upstream.rawHeaders[i + 1]);
  }

  const status = upstream.statusCode ?? 502;
  return new Response(NO_BODY_STATUS.has(status) ? null : Readable.toWeb(upstream), {
    status,
    statusText: upstream.statusMessage,
    headers: responseHeaders,
  });
};

// Serves the API and the short-link redirect at their real URLs, so no rewrite
// rules in netlify.toml are needed and Express sees the original path.
export const config = { path: ['/api/*', '/s/*'] };
