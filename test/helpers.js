import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Starts the real Express app on an ephemeral port with its own empty data
 * directories. Config is read from the environment when the server modules are
 * first imported, and `node --test` runs every file in its own process, so each
 * test file can choose its own settings through `env`.
 */
export async function startServer(env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nfs-test-'));
  Object.assign(process.env, {
    NETFILESHARE_STORE: 'disk',
    NETFILESHARE_DATA_DIR: path.join(dir, 'data'),
    NETFILESHARE_STORAGE_DIR: path.join(dir, 'files'),
    NETFILESHARE_RATE_LIMIT: 'off',
    ...env,
  });

  const { createApp } = await import('../server/app.js');
  const server = await new Promise((resolve) => {
    const listening = createApp().listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  /** fetch with JSON helpers; `json` bodies are encoded, everything else passes through. */
  async function call(method, route, { json, headers = {}, body, redirect } = {}) {
    const init = { method, headers: { ...headers }, redirect };
    if (json !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(json);
    } else if (body !== undefined) {
      init.body = body;
    }
    const response = await fetch(base + route, init);
    const type = response.headers.get('content-type') ?? '';
    const data = type.includes('application/json') ? await response.json() : null;
    return { status: response.status, headers: response.headers, data, response };
  }

  return {
    base,
    call,
    dir,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
