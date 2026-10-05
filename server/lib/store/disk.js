import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, STORAGE_DIR } from '../config.js';

/**
 * Record keys are produced by this app (`workspaces/<CODE>`, `links/<slug>`,
 * `files/<workspaceId>/<itemId>`), never by a client, but the guard stays so a
 * future caller cannot turn a key into a traversal.
 */
function assertSafeKey(key) {
  const value = String(key ?? '');
  if (!value) throw new Error('A storage key is required');
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe storage key: ${value}`);
  }
  return segments;
}

function metaPath(key) {
  return path.join(DATA_DIR, `${assertSafeKey(key).join(path.sep)}.json`);
}

function filePath(key) {
  return path.join(STORAGE_DIR, assertSafeKey(key).join(path.sep));
}

async function ensureParent(target) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
}

async function readJsonFile(target) {
  try {
    const raw = await fsp.readFile(target, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    // A truncated or hand-edited record should not take the whole app down.
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function removeIfPresent(target, options = {}) {
  await fsp.rm(target, { force: true, ...options });
}

export function createDiskStore() {
  let readyPromise = null;

  function ready() {
    readyPromise ??= (async () => {
      await fsp.mkdir(DATA_DIR, { recursive: true });
      await fsp.mkdir(STORAGE_DIR, { recursive: true });
    })();
    return readyPromise;
  }

  return {
    driver: 'disk',

    async getRecord(key) {
      await ready();
      return readJsonFile(metaPath(key));
    },

    async putRecord(key, value) {
      await ready();
      const target = metaPath(key);
      await ensureParent(target);
      // Write-then-rename so a crash mid-write cannot leave a partial record.
      const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fsp.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
      await fsp.rename(temp, target);
      return value;
    },

    async deleteRecord(key) {
      await ready();
      await removeIfPresent(metaPath(key));
    },

    async listRecords(prefix) {
      await ready();
      const dir = path.join(DATA_DIR, assertSafeKey(prefix).join(path.sep));
      let entries = [];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
      }
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) => readJsonFile(path.join(dir, entry.name))),
      );
      return records.filter(Boolean);
    },

    async putFile(key, buffer) {
      await ready();
      const target = filePath(key);
      await ensureParent(target);
      await fsp.writeFile(target, buffer);
    },

    async getFileBuffer(key) {
      await ready();
      try {
        return await fsp.readFile(filePath(key));
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
    },

    /** Lets the self-hosted path stream large downloads instead of buffering. */
    async getFileStream(key) {
      await ready();
      const target = filePath(key);
      try {
        await fsp.access(target);
      } catch {
        return null;
      }
      return fs.createReadStream(target);
    },

    async deleteFile(key) {
      await ready();
      await removeIfPresent(filePath(key));
    },

    async deleteFilePrefix(prefix) {
      await ready();
      await removeIfPresent(filePath(prefix), { recursive: true });
    },
  };
}
