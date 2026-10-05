import { Readable } from 'node:stream';
import { getStore } from '@netlify/blobs';
import { BLOB_STORE_NAME } from '../config.js';

/**
 * Netlify Blobs backend, used because a Netlify Function's filesystem is
 * ephemeral and read-only outside /tmp. Metadata and file bytes share one
 * site-scoped (deploy-agnostic) store under distinct key prefixes, so data
 * survives redeploys.
 */
export function createBlobStore() {
  let cached = null;

  function store() {
    cached ??= getStore({ name: BLOB_STORE_NAME, consistency: 'strong' });
    return cached;
  }

  function metaKey(key) {
    return `meta/${key}.json`;
  }

  function fileKey(key) {
    return `blob/${key}`;
  }

  return {
    driver: 'blobs',

    async getRecord(key) {
      const value = await store().get(metaKey(key), { type: 'json' });
      return value ?? null;
    },

    async putRecord(key, value) {
      await store().setJSON(metaKey(key), value);
      return value;
    },

    async deleteRecord(key) {
      await store().delete(metaKey(key));
    },

    async listRecords(prefix) {
      const { blobs } = await store().list({ prefix: `meta/${prefix}/` });
      const records = await Promise.all(
        blobs.map(async (blob) => {
          try {
            return await store().get(blob.key, { type: 'json' });
          } catch {
            return null;
          }
        }),
      );
      return records.filter(Boolean);
    },

    async putFile(key, buffer) {
      // Blobs accepts an ArrayBuffer; slice so a pooled Buffer view is not over-sent.
      const body = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      await store().set(fileKey(key), body);
    },

    async getFileBuffer(key) {
      const value = await store().get(fileKey(key), { type: 'arrayBuffer' });
      return value ? Buffer.from(value) : null;
    },

    async getFileStream(key) {
      const value = await store().get(fileKey(key), { type: 'stream' });
      return value ? Readable.fromWeb(value) : null;
    },

    async deleteFile(key) {
      await store().delete(fileKey(key));
    },

    async deleteFilePrefix(prefix) {
      const { blobs } = await store().list({ prefix: fileKey(`${prefix}/`) });
      await Promise.all(blobs.map((blob) => store().delete(blob.key)));
    },
  };
}
