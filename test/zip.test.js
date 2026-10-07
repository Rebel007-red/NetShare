import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { after, before, describe, it } from 'node:test';
import { startServer } from './helpers.js';
import { crc32 } from '../server/lib/zip.js';

/**
 * A deliberately separate ZIP reader: it follows the format spec (end record ->
 * central directory -> local headers), so it checks what the writer produced
 * rather than sharing its assumptions.
 */
function readZip(buffer) {
  const endAt = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(endAt >= 0, 'end of central directory record is present');
  const count = buffer.readUInt16LE(endAt + 10);
  let cursor = buffer.readUInt32LE(endAt + 16);
  const entries = {};

  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50, 'central directory signature');
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressed = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const offset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    assert.equal(buffer.readUInt32LE(offset), 0x04034b50, 'local header signature');
    const localName = buffer.readUInt16LE(offset + 26);
    const localExtra = buffer.readUInt16LE(offset + 28);
    const start = offset + 30 + localName + localExtra;
    const raw = buffer.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(raw) : raw;

    assert.equal(data.length, size, `${name}: size`);
    assert.equal(crc32(data), crc, `${name}: crc`);
    entries[name] = data;
    cursor += 46 + nameLength + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
  return entries;
}

describe('folder ZIP download', () => {
  let app;
  let code;
  const text = 'hello zip '.repeat(500); // compresses well, exercises deflate
  const noise = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 97) % 256)); // exercises "stored"

  before(async () => {
    app = await startServer({ NETFILESHARE_MAX_ZIP_MB: '1' });
    code = (await app.call('POST', '/api/workspaces', { json: { name: 'Team files' } })).data.code;
    await app.call('POST', `/api/workspaces/${code}/folders`, { json: { parentPath: '/', name: 'docs' } });
    await app.call('POST', `/api/workspaces/${code}/folders`, { json: { parentPath: '/', name: 'empty' } });

    const upload = async (parentPath, name, bytes) => {
      const form = new FormData();
      form.set('parentPath', parentPath);
      form.append('files', new Blob([bytes]), name);
      const result = await app.call('POST', `/api/workspaces/${code}/files`, { body: form });
      assert.equal(result.status, 201);
    };
    await upload('/', 'readme.txt', text);
    await upload('/docs', 'ünïcode — notes.txt', 'unicode name');
    await upload('/docs', 'noise.bin', noise);
  });
  after(() => app.close());

  const zipOf = async (query = '') => {
    const response = await fetch(`${app.base}/api/workspaces/${code}/zip${query}`);
    return { response, bytes: Buffer.from(await response.arrayBuffer()) };
  };

  it('zips the whole workspace with correct names, folders and bytes', async () => {
    const { response, bytes } = await zipOf();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.match(response.headers.get('content-disposition'), /Team%20files\.zip/);

    const entries = readZip(bytes);
    assert.deepEqual(Object.keys(entries).sort(), [
      'docs/',
      'docs/noise.bin',
      'docs/ünïcode — notes.txt',
      'empty/',
      'readme.txt',
    ]);
    assert.equal(entries['readme.txt'].toString(), text);
    assert.equal(entries['docs/ünïcode — notes.txt'].toString(), 'unicode name');
    assert.ok(entries['docs/noise.bin'].equals(noise));
  });

  it('compresses what it can and stores the rest', async () => {
    const { bytes } = await zipOf();
    assert.ok(bytes.length < text.length, 'repetitive text shrank');
  });

  it('zips one folder with names relative to it', async () => {
    const { response, bytes } = await zipOf('?path=/docs');
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(readZip(bytes)).sort(), ['noise.bin', 'ünïcode — notes.txt']);
  });

  it('refuses an empty folder and a non-folder', async () => {
    assert.equal((await zipOf('?path=/empty')).response.status, 400);
    assert.equal((await zipOf('?path=/readme.txt')).response.status, 400);
    assert.equal((await zipOf('?path=/missing')).response.status, 404);
  });

  it('refuses a folder over the size limit with a clear message', async () => {
    const big = new Uint8Array(1024 * 1024 + 10);
    const form = new FormData();
    form.set('parentPath', '/');
    form.append('files', new Blob([big]), 'big.bin');
    await app.call('POST', `/api/workspaces/${code}/files`, { body: form });
    const result = await app.call('GET', `/api/workspaces/${code}/zip`);
    assert.equal(result.status, 413);
    assert.match(result.data.message, /too big for one ZIP/);
  });
});
