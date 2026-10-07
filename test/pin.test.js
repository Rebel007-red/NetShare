import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startServer } from './helpers.js';

/** fetch has no cookie jar, so carry the unlock cookie by hand like a browser would. */
function cookieFrom(result) {
  const raw = result.response.headers.getSetCookie?.() ?? [];
  const pair = raw.map((value) => value.split(';')[0]).find((value) => value.startsWith('nfs_pin_') && !value.endsWith('='));
  return pair ?? '';
}

describe('PIN protection', () => {
  let app;
  before(async () => {
    app = await startServer();
  });
  after(() => app.close());

  for (const kind of ['notes', 'workspaces']) {
    describe(kind, () => {
      let code;
      let cookie;
      const create = async () => {
        const json = kind === 'notes' ? { content: 'secret body', format: 'text' } : { name: 'Private' };
        return (await app.call('POST', `/api/${kind}`, { json })).data.code;
      };
      const get = (headers = {}) => app.call('GET', `/api/${kind}/${code}`, { headers });

      before(async () => {
        code = await create();
      });

      it('starts unprotected', async () => {
        const result = await get();
        assert.equal(result.status, 200);
        assert.equal(result.data.hasPin, false);
      });

      it('rejects PINs that are too short', async () => {
        const result = await app.call('POST', `/api/${kind}/${code}/pin`, { json: { pin: '12' } });
        assert.equal(result.status, 400);
      });

      it('locks everything once a PIN is set, and unlocks the setter', async () => {
        const result = await app.call('POST', `/api/${kind}/${code}/pin`, { json: { pin: 'open-sesame' } });
        assert.equal(result.status, 200);
        assert.equal(result.data.hasPin, true);
        assert.equal(result.data.pinHash, undefined, 'the hash never leaves the server');
        cookie = cookieFrom(result);
        assert.ok(cookie, 'setting a PIN hands the setter an unlock cookie');

        assert.equal((await get({ cookie })).status, 200);
      });

      it('answers pin_required to anyone without the cookie', async () => {
        const result = await get();
        assert.equal(result.status, 401);
        assert.equal(result.data.code, 'pin_required');
        const sub = kind === 'notes' ? '/raw' : '/zip';
        assert.equal((await app.call('GET', `/api/${kind}/${code}${sub}`)).status, 401);
      });

      it('rejects a wrong PIN and accepts the right one', async () => {
        const wrong = await app.call('POST', `/api/${kind}/${code}/unlock`, { json: { pin: 'nope-nope' } });
        assert.equal(wrong.status, 401);
        assert.equal(wrong.data.code, 'wrong_pin');

        const right = await app.call('POST', `/api/${kind}/${code}/unlock`, { json: { pin: 'open-sesame' } });
        assert.equal(right.status, 204);
        const fresh = cookieFrom(right);
        assert.ok(fresh);
        assert.equal((await get({ cookie: fresh })).status, 200);
      });

      it('does not let a forged cookie in', async () => {
        assert.equal((await get({ cookie: `nfs_pin_${code}=deadbeef` })).status, 401);
      });

      it('invalidates old cookies when the PIN changes', async () => {
        const changed = await app.call('POST', `/api/${kind}/${code}/pin`, { json: { pin: 'second-pin' }, headers: { cookie } });
        assert.equal(changed.status, 200);
        assert.equal((await get({ cookie })).status, 401, 'the old cookie no longer works');
        assert.equal((await get({ cookie: cookieFrom(changed) })).status, 200);
        cookie = cookieFrom(changed);
      });

      it('needs the PIN to change the PIN', async () => {
        const result = await app.call('POST', `/api/${kind}/${code}/pin`, { json: { pin: null } });
        assert.equal(result.status, 401);
      });

      it('can be cleared by someone unlocked', async () => {
        const cleared = await app.call('POST', `/api/${kind}/${code}/pin`, { json: { pin: null }, headers: { cookie } });
        assert.equal(cleared.status, 200);
        assert.equal(cleared.data.hasPin, false);
        assert.equal((await get()).status, 200);
      });
    });
  }

  it('records the PIN being set and cleared, never the PIN itself', async () => {
    const { data } = await app.call('POST', '/api/notes', { json: { content: 'x', format: 'text' } });
    const set = await app.call('POST', `/api/notes/${data.code}/pin`, { json: { pin: 'hunter22' } });
    const types = set.data.activity.map((entry) => entry.type);
    assert.ok(types.includes('pin-set'));
    assert.ok(!JSON.stringify(set.data).includes('hunter22'));
  });
});
