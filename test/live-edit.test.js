import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import DiffMatchPatch from 'diff-match-patch';
import { startServer } from './helpers.js';

const dmp = new DiffMatchPatch();
const patchFor = (from, to) => dmp.patch_toText(dmp.patch_make(from, to));

const BASE = Array.from({ length: 12 }, (_, i) => `line ${i + 1}: the quick brown fox`).join('\n');
const A = 'clientAAAA1';
const B = 'clientBBBB2';

describe('live editing', () => {
  let app;
  before(async () => {
    app = await startServer();
  });
  after(() => app.close());

  const createLive = async (content = BASE) => {
    const { data } = await app.call('POST', '/api/notes', { json: { title: 't', content, format: 'text', isCollaborative: true } });
    return data;
  };
  const sync = (code, body) => app.call('POST', `/api/notes/${code}/sync`, { json: body });

  it('merges edits made in different places at the same time', async () => {
    const note = await createLive();
    const aText = BASE.replace('line 2:', 'line 2 (edited by A):');
    const bText = BASE.replace('line 11:', 'line 11 (edited by B):');

    const a = await sync(note.code, { clientId: A, opId: 'a1', rev: 0, patch: patchFor(BASE, aText) });
    const b = await sync(note.code, { clientId: B, opId: 'b1', rev: 0, patch: patchFor(BASE, bText) });

    assert.equal(a.data.rev, 1);
    assert.equal(b.data.rev, 2);
    assert.equal(b.data.rejected, 0);
    assert.ok(b.data.content.includes('edited by A') && b.data.content.includes('edited by B'));
    assert.equal(b.data.editors, 2);
  });

  it('keeps both inserts when two people type at the same spot', async () => {
    const note = await createLive();
    const x = BASE.replace('line 5:', 'line 5 XXX:');
    const y = BASE.replace('line 5:', 'line 5 YYY:');
    await sync(note.code, { clientId: A, opId: 'x', rev: 0, patch: patchFor(BASE, x) });
    const { data } = await sync(note.code, { clientId: B, opId: 'y', rev: 0, patch: patchFor(BASE, y) });
    assert.ok(data.content.includes('XXX') && data.content.includes('YYY'));
  });

  it('applies a retried request only once', async () => {
    const note = await createLive();
    const patch = patchFor(BASE, BASE.replace('line 3:', 'line 3 ONCE:'));
    const first = await sync(note.code, { clientId: A, opId: 'same-op', rev: 0, patch });
    const retry = await sync(note.code, { clientId: A, opId: 'same-op', rev: 0, patch });
    assert.equal(retry.data.rev, first.data.rev);
    assert.equal(retry.data.content.split('ONCE').length - 1, 1);
  });

  it('answers a poll with text only when the client is behind', async () => {
    const note = await createLive();
    const current = await sync(note.code, { clientId: A, opId: 'p1', rev: 0 });
    assert.equal(current.data.unchanged, true);
    assert.equal(current.data.content, undefined);

    await sync(note.code, { clientId: B, opId: 'p2', rev: 0, patch: patchFor(BASE, `${BASE}\nmore`) });
    const behind = await sync(note.code, { clientId: A, opId: 'p3', rev: 0 });
    assert.equal(behind.data.unchanged, false);
    assert.ok(behind.data.content.endsWith('more'));
  });

  it('reports a hunk it cannot merge instead of swallowing it', async () => {
    const note = await createLive();
    const stale = patchFor('totally different base text here', 'totally different base text here, edited');
    const { data } = await sync(note.code, { clientId: A, opId: 'stale', rev: 0, patch: stale });
    assert.ok(data.rejected >= 1);
    assert.equal(typeof data.content, 'string', 'the client is told the real text');
  });

  it('counts editors but not read-only viewers', async () => {
    const note = await createLive();
    await sync(note.code, { clientId: A, opId: 'e1', rev: 0 });
    const viewer = await sync(note.code, { viewer: true, rev: 0 });
    assert.equal(viewer.data.editors, 1);
  });

  it('rejects bad input', async () => {
    const note = await createLive();
    assert.equal((await sync(note.code, { clientId: 'x', opId: 'z', rev: 0 })).status, 400);
    assert.equal((await sync(note.code, { clientId: A, opId: 'z', rev: 0, patch: '@@ nonsense @@\n+zzz' })).status, 400);
  });

  it('enforces the note size limit', async () => {
    const note = await createLive();
    const huge = patchFor(BASE, BASE + 'x'.repeat(300 * 1024));
    assert.equal((await sync(note.code, { clientId: A, opId: 'big', rev: 0, patch: huge })).status, 413);
  });

  it('lets everything be deleted while editing live', async () => {
    const note = await createLive();
    const { data } = await sync(note.code, { clientId: A, opId: 'clear', rev: 0, patch: patchFor(BASE, '') });
    assert.equal(data.content, '');
  });

  it('refuses to sync a note that is not live', async () => {
    const { data } = await app.call('POST', '/api/notes', { json: { content: 'plain', format: 'text' } });
    assert.equal((await sync(data.code, { clientId: A, opId: 'n', rev: 0 })).status, 409);
  });

  it('keeps every edit when twenty people save at once', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => `row ${i}`).join('\n');
    const note = await createLive(rows);
    await Promise.all(Array.from({ length: 20 }, (_, i) => sync(note.code, {
      clientId: `client${String(i).padStart(6, '0')}`,
      opId: `par${i}`,
      rev: 0,
      patch: patchFor(rows, rows.replace(`row ${i}`, `row ${i} done`)),
    })));
    const { data } = await app.call('GET', `/api/notes/${note.code}`);
    for (let i = 0; i < 20; i += 1) assert.ok(data.content.includes(`row ${i} done`), `row ${i}`);
  });

  it('bumps the revision when the note is replaced wholesale, so open editors catch up', async () => {
    const note = await createLive();
    const before = (await sync(note.code, { clientId: A, opId: 'r', rev: 0 })).data.rev;
    const replaced = await app.call('PATCH', `/api/notes/${note.code}`, { json: { content: 'brand new text' } });
    assert.ok(replaced.data.rev > before);
    const poll = await sync(note.code, { clientId: A, opId: 'r2', rev: before });
    assert.equal(poll.data.content, 'brand new text');
  });
});
