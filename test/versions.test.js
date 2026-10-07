import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import DiffMatchPatch from 'diff-match-patch';
import { startServer } from './helpers.js';

const dmp = new DiffMatchPatch();
const patchFor = (from, to) => dmp.patch_toText(dmp.patch_make(from, to));

describe('note version history', () => {
  let app;
  before(async () => {
    app = await startServer();
  });
  after(() => app.close());

  const versions = async (code) => (await app.call('GET', `/api/notes/${code}/versions`)).data.versions;

  it('saves the old text before a full replace, and restores it', async () => {
    const { data: note } = await app.call('POST', '/api/notes', { json: { title: 'doc', content: 'first draft', format: 'text' } });
    await app.call('PATCH', `/api/notes/${note.code}`, { json: { content: 'second draft' } });
    await app.call('PATCH', `/api/notes/${note.code}`, { json: { content: 'third draft' } });

    const list = await versions(note.code);
    assert.deepEqual(list.map((v) => v.preview), ['second draft', 'first draft']);
    assert.equal(list[0].content, undefined, 'the list stays light: previews, not full text');

    const first = list.find((v) => v.preview === 'first draft');
    const restored = await app.call('POST', `/api/notes/${note.code}/versions/${first.id}/restore`);
    assert.equal(restored.status, 200);
    assert.equal(restored.data.content, 'first draft');
    assert.ok(restored.data.rev > 0);

    // The text that was replaced by the restore is itself saved, so a restore is undoable.
    const after = await versions(note.code);
    assert.ok(after.some((v) => v.preview === 'third draft' && v.reason === 'before restore'));
  });

  it('serves one version in full', async () => {
    const { data: note } = await app.call('POST', '/api/notes', { json: { content: 'alpha beta', format: 'text' } });
    await app.call('PATCH', `/api/notes/${note.code}`, { json: { content: 'changed' } });
    const [entry] = await versions(note.code);
    const full = await app.call('GET', `/api/notes/${note.code}/versions/${entry.id}`);
    assert.equal(full.data.content, 'alpha beta');
    assert.equal((await app.call('GET', `/api/notes/${note.code}/versions/ver_missing`)).status, 404);
  });

  it('snapshots a live note before a large deletion', async () => {
    const body = 'keep this paragraph.\n'.repeat(60);
    const { data: note } = await app.call('POST', '/api/notes', { json: { content: body, format: 'text', isCollaborative: true } });
    const sync = (patch, opId) => app.call('POST', `/api/notes/${note.code}/sync`, {
      json: { clientId: 'clientAAAA1', opId, rev: 0, patch },
    });

    // The first edit takes the periodic snapshot; wipe the text straight after.
    await sync(patchFor(body, `${body}tail`), 'o1');
    const current = (await app.call('GET', `/api/notes/${note.code}`)).data.content;
    await sync(patchFor(current, ''), 'o2');

    const list = await versions(note.code);
    assert.ok(list.some((v) => v.reason === 'before large deletion' && v.preview.startsWith('keep this paragraph')));
  });

  it('keeps no more than twenty versions', async () => {
    const { data: note } = await app.call('POST', '/api/notes', { json: { content: 'v0', format: 'text' } });
    for (let i = 1; i <= 25; i += 1) {
      await app.call('PATCH', `/api/notes/${note.code}`, { json: { content: `v${i}` } });
    }
    const list = await versions(note.code);
    assert.equal(list.length, 20);
    assert.equal(list[0].preview, 'v24', 'newest first');
  });

  it('is removed together with the note', async () => {
    const { data: note } = await app.call('POST', '/api/notes', { json: { content: 'one', format: 'text' } });
    await app.call('PATCH', `/api/notes/${note.code}`, { json: { content: 'two' } });
    assert.equal((await versions(note.code)).length, 1);
    await app.call('DELETE', `/api/notes/${note.code}`);
    assert.equal((await app.call('GET', `/api/notes/${note.code}/versions`)).status, 404);
  });
});
