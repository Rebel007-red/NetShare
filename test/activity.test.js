import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import DiffMatchPatch from 'diff-match-patch';
import { startServer } from './helpers.js';

const dmp = new DiffMatchPatch();
const patchFor = (from, to) => dmp.patch_toText(dmp.patch_make(from, to));

describe('activity log', () => {
  let app;
  before(async () => {
    app = await startServer();
  });
  after(() => app.close());

  const types = (data) => data.activity.map((entry) => entry.type);

  it('records workspace events, newest first, with no author', async () => {
    const { data: ws } = await app.call('POST', '/api/workspaces', { json: { name: 'Log' } });
    const code = ws.code;
    await app.call('POST', `/api/workspaces/${code}/folders`, { json: { parentPath: '/', name: 'docs' } });

    const form = new FormData();
    form.set('parentPath', '/');
    for (const name of ['a.txt', 'b.txt', 'c.txt']) form.append('files', new Blob(['x']), name);
    await app.call('POST', `/api/workspaces/${code}/files`, { body: form });

    await app.call('PATCH', `/api/workspaces/${code}/items/rename`, { json: { path: '/a.txt', name: 'renamed.txt' } });
    await app.call('DELETE', `/api/workspaces/${code}/items?path=${encodeURIComponent('/b.txt')}`);
    await app.call('POST', `/api/workspaces/${code}/extend`);

    const { data } = await app.call('GET', `/api/workspaces/${code}`);
    assert.deepEqual(types(data), ['extended', 'deleted', 'renamed', 'uploaded', 'folder', 'created']);

    const uploaded = data.activity.find((entry) => entry.type === 'uploaded');
    assert.match(uploaded.detail, /and 1 more/, 'long uploads are summarised');
    for (const entry of data.activity) {
      assert.deepEqual(Object.keys(entry).filter((key) => entry[key] !== undefined).sort().filter((key) => !['at', 'type', 'detail', 'count'].includes(key)), []);
    }
  });

  it('collapses a burst of live edits into one line', async () => {
    const { data: note } = await app.call('POST', '/api/notes', { json: { content: 'start', format: 'text', isCollaborative: true } });
    let text = 'start';
    for (let i = 0; i < 4; i += 1) {
      const next = `${text} ${i}`;
      await app.call('POST', `/api/notes/${note.code}/sync`, {
        json: { clientId: 'clientAAAA1', opId: `o${i}`, rev: 0, patch: patchFor(text, next) },
      });
      text = next;
    }
    const { data } = await app.call('GET', `/api/notes/${note.code}`);
    const edits = data.activity.filter((entry) => entry.type === 'edited');
    assert.equal(edits.length, 1);
    assert.equal(edits[0].count, 4);
  });

  it('records toggles on notes', async () => {
    const { data: note } = await app.call('POST', '/api/notes', { json: { content: 'x', format: 'text' } });
    await app.call('PATCH', `/api/notes/${note.code}`, { json: { isCollaborative: true } });
    await app.call('POST', `/api/notes/${note.code}/persistence`, { json: { isPersistent: true } });
    const { data } = await app.call('GET', `/api/notes/${note.code}`);
    assert.deepEqual(types(data).slice(0, 2), ['kept', 'live-on']);
  });

  it('never grows without bound', async () => {
    const { data: ws } = await app.call('POST', '/api/workspaces', { json: {} });
    for (let i = 0; i < 50; i += 1) await app.call('POST', `/api/workspaces/${ws.code}/extend`);
    const { data } = await app.call('GET', `/api/workspaces/${ws.code}`);
    assert.ok(data.activity.length <= 40);
  });
});
