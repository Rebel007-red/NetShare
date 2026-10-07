import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startServer } from './helpers.js';

describe('team passphrase', () => {
  let app;
  before(async () => {
    app = await startServer({ NETFILESHARE_ACCESS_KEY: 'team-secret' });
  });
  after(() => app.close());

  const withKey = { 'x-access-key': 'team-secret' };

  it('health says a passphrase is required', async () => {
    const { data } = await app.call('GET', '/api/health');
    assert.equal(data.accessRequired, true);
  });

  it('refuses to create anything without it', async () => {
    for (const [route, json] of [
      ['/api/notes', { content: 'hi', format: 'text' }],
      ['/api/workspaces', {}],
      ['/api/links', { targetUrl: 'https://example.com' }],
    ]) {
      const result = await app.call('POST', route, { json });
      assert.equal(result.status, 401, route);
      assert.equal(result.data.code, 'access_required', route);
    }
  });

  it('refuses a wrong passphrase and accepts the right one', async () => {
    const body = { content: 'hi', format: 'text' };
    const wrong = await app.call('POST', '/api/notes', { json: body, headers: { 'x-access-key': 'nope' } });
    assert.equal(wrong.status, 401);
    const right = await app.call('POST', '/api/notes', { json: body, headers: withKey });
    assert.equal(right.status, 201);
  });

  it('does not gate use: a code holder needs no passphrase', async () => {
    const created = await app.call('POST', '/api/notes', {
      json: { content: 'hello', format: 'text' },
      headers: withKey,
    });
    const { code } = created.data;
    assert.equal((await app.call('GET', `/api/notes/${code}`)).status, 200);
    assert.equal((await app.call('PATCH', `/api/notes/${code}`, { json: { title: 'renamed' } })).status, 200);
    assert.equal((await app.call('DELETE', `/api/notes/${code}`)).status, 204);
  });

  it('POST /api/access checks a passphrase without creating anything', async () => {
    assert.equal((await app.call('POST', '/api/access', { json: { key: 'team-secret' } })).status, 204);
    assert.equal((await app.call('POST', '/api/access', { json: { key: 'wrong' } })).status, 401);
  });
});
