import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startServer } from './helpers.js';

describe('core API', () => {
  let app;
  before(async () => {
    app = await startServer({ NETFILESHARE_MAX_UPLOAD_MB: '1' });
  });
  after(() => app.close());

  const upload = (code, name, bytes, parentPath = '/') => {
    const form = new FormData();
    form.set('parentPath', parentPath);
    form.append('files', new Blob([bytes]), name);
    return app.call('POST', `/api/workspaces/${code}/files`, { body: form });
  };

  describe('health', () => {
    it('serves the limits the UI renders', async () => {
      const { data } = await app.call('GET', '/api/health');
      assert.equal(data.ok, true);
      assert.equal(data.maxUploadBytes, 1024 * 1024);
      assert.equal(data.accessRequired, false);
    });
  });

  describe('workspaces', () => {
    it('uploads and downloads bytes exactly, including non-ASCII names', async () => {
      const { data: ws } = await app.call('POST', '/api/workspaces', { json: {} });
      const bytes = Buffer.from([0, 255, 128, 10, 200, 1, 2, 3]);
      const result = await upload(ws.code, 'ünï.bin', bytes);
      assert.equal(result.status, 201);
      const file = result.data.items.find((item) => item.type === 'file');
      assert.equal(file.name, 'ünï.bin');

      const response = await fetch(`${app.base}/api/workspaces/${ws.code}/download?path=${encodeURIComponent(file.path)}`);
      assert.equal(response.status, 200);
      assert.ok(Buffer.from(await response.arrayBuffer()).equals(bytes));
    });

    it('rejects a file over the limit with a clear 413', async () => {
      const { data: ws } = await app.call('POST', '/api/workspaces', { json: {} });
      const result = await upload(ws.code, 'big.bin', new Uint8Array(1024 * 1024 + 1));
      assert.equal(result.status, 413);
      assert.match(result.data.message, /1 MB or smaller/);
    });

    it('never lets a path escape the workspace', async () => {
      const { data: ws } = await app.call('POST', '/api/workspaces', { json: {} });
      const bad = await app.call('POST', `/api/workspaces/${ws.code}/folders`, { json: { parentPath: '/', name: '..' } });
      assert.equal(bad.status, 400);
      const traversal = await app.call('POST', `/api/workspaces/${ws.code}/folders`, { json: { parentPath: '/../..', name: 'x' } });
      assert.equal(traversal.status, 400);
    });

    it('refuses a name that is already taken', async () => {
      const { data: ws } = await app.call('POST', '/api/workspaces', { json: {} });
      assert.equal((await upload(ws.code, 'same.txt', 'a')).status, 201);
      assert.equal((await upload(ws.code, 'same.txt', 'b')).status, 409);
    });

    it('renames a folder and moves what is inside it', async () => {
      const { data: ws } = await app.call('POST', '/api/workspaces', { json: {} });
      await app.call('POST', `/api/workspaces/${ws.code}/folders`, { json: { parentPath: '/', name: 'old' } });
      await upload(ws.code, 'f.txt', 'x', '/old');
      const renamed = await app.call('PATCH', `/api/workspaces/${ws.code}/items/rename`, { json: { path: '/old', name: 'new' } });
      assert.ok(renamed.data.items.some((item) => item.path === '/new/f.txt'));
    });

    it('deletes everything with the workspace', async () => {
      const { data: ws } = await app.call('POST', '/api/workspaces', { json: {} });
      await upload(ws.code, 'gone.txt', 'x');
      assert.equal((await app.call('DELETE', `/api/workspaces/${ws.code}`)).status, 204);
      assert.equal((await app.call('GET', `/api/workspaces/${ws.code}`)).status, 404);
    });

    it('extends from whichever is later: now or the current expiry', async () => {
      const { data: ws } = await app.call('POST', '/api/workspaces', { json: {} });
      const extended = await app.call('POST', `/api/workspaces/${ws.code}/extend`);
      assert.ok(Date.parse(extended.data.expiresAt) > Date.parse(ws.expiresAt));
    });
  });

  describe('short links', () => {
    it('redirects, and counts the click', async () => {
      const { data: link } = await app.call('POST', '/api/links', { json: { targetUrl: 'https://example.com/a', alias: 'apitest1' } });
      assert.equal(link.slug, 'apitest1');
      const hit = await app.call('GET', '/s/apitest1', { redirect: 'manual' });
      assert.equal(hit.status, 302);
      assert.equal(hit.headers.get('location'), 'https://example.com/a');
    });

    it('refuses schemes that would make a link an XSS vector', async () => {
      for (const targetUrl of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd']) {
        const result = await app.call('POST', '/api/links', { json: { targetUrl } });
        assert.equal(result.status, 400, targetUrl);
      }
    });

    it('refuses a taken or reserved alias', async () => {
      await app.call('POST', '/api/links', { json: { targetUrl: 'https://example.com', alias: 'takenalias' } });
      assert.equal((await app.call('POST', '/api/links', { json: { targetUrl: 'https://example.com', alias: 'takenalias' } })).status, 409);
      assert.equal((await app.call('POST', '/api/links', { json: { targetUrl: 'https://example.com', alias: 'api' } })).status, 409);
    });

    it('404s an unknown slug', async () => {
      assert.equal((await app.call('GET', '/s/doesnotexist', { redirect: 'manual' })).status, 404);
    });
  });

  describe('notes', () => {
    it('round-trips content and serves the raw text', async () => {
      const { data: note } = await app.call('POST', '/api/notes', { json: { title: 'T', content: '# Hi\n\nbody', format: 'markdown' } });
      assert.match(note.code, /^[A-Z1-9]{6}$/);
      const raw = await fetch(`${app.base}/api/notes/${note.code}/raw`);
      assert.equal(await raw.text(), '# Hi\n\nbody');
      assert.equal(raw.headers.get('x-content-type-options'), 'nosniff');
    });

    it('rejects empty content, unknown formats and oversize notes', async () => {
      assert.equal((await app.call('POST', '/api/notes', { json: { content: '   ', format: 'text' } })).status, 400);
      assert.equal((await app.call('POST', '/api/notes', { json: { content: 'x', format: 'html' } })).status, 400);
      assert.equal((await app.call('POST', '/api/notes', { json: { content: 'x'.repeat(300 * 1024), format: 'text' } })).status, 413);
    });

    it('does not leak internal fields', async () => {
      const { data: note } = await app.call('POST', '/api/notes', { json: { content: 'x', format: 'text', isCollaborative: true } });
      await app.call('POST', `/api/notes/${note.code}/sync`, { json: { clientId: 'clientAAAA1', opId: 'o', rev: 0 } });
      const { data } = await app.call('GET', `/api/notes/${note.code}`);
      for (const secret of ['presence', 'recentOps', 'pinHash', 'pinSalt', 'lastSnapshotAt']) {
        assert.equal(data[secret], undefined, secret);
      }
    });

    it('codes come from the safe alphabet', async () => {
      for (let i = 0; i < 25; i += 1) {
        const { data } = await app.call('POST', '/api/notes', { json: { content: 'x', format: 'text' } });
        assert.doesNotMatch(data.code, /[IO0]/);
      }
    });
  });
});
