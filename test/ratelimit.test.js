import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startServer } from './helpers.js';

describe('rate limits', () => {
  let app;
  before(async () => {
    app = await startServer({
      NETFILESHARE_RATE_LIMIT: 'on',
      NETFILESHARE_RATE_CREATE_PER_HOUR: '3',
      NETFILESHARE_RATE_MISS_PER_10_MIN: '5',
      // A direct client, so a forged X-Forwarded-For must not be believed.
      NETFILESHARE_TRUST_PROXY: 'false',
    });
  });
  after(() => app.close());

  it('limits how many things one address can create', async () => {
    const make = (spoof) => app.call('POST', '/api/notes', {
      json: { content: 'x', format: 'text' },
      headers: spoof ? { 'x-forwarded-for': spoof } : {},
    });
    assert.equal((await make()).status, 201);
    assert.equal((await make('10.0.0.1')).status, 201);
    assert.equal((await make('10.0.0.2')).status, 201);
    // Changing the forged address does not buy a fresh allowance.
    const blocked = await make('10.0.0.3');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.data.code, 'rate_limited');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  });

  it('shuts out an address that keeps guessing codes', async () => {
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await app.call('GET', `/api/notes/ZZZZZ${i + 1}`)).status, 404);
    }
    assert.equal((await app.call('GET', '/api/notes/ABCDEF')).status, 429);
    assert.equal((await app.call('GET', '/api/workspaces/ABCDEF')).status, 429);
    assert.equal((await app.call('GET', '/s/whatever')).status, 429);
  });
});
