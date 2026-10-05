import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Netlify's esbuild bundles the function as CommonJS, where import.meta.url is
// undefined. ROOT_DIR is only used by the disk store and static serving, neither
// of which runs there, so the working directory is a safe fallback.
const __dirname = import.meta.url
  ? path.dirname(fileURLToPath(import.meta.url))
  : path.join(process.cwd(), 'server', 'lib');

export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const DATA_DIR = process.env.NETFILESHARE_DATA_DIR || path.join(ROOT_DIR, 'server-data');
export const STORAGE_DIR = process.env.NETFILESHARE_STORAGE_DIR || path.join(ROOT_DIR, 'storage');
export const DIST_DIR = path.join(ROOT_DIR, 'dist');

export const PORT = Number(process.env.NETFILESHARE_PORT || 8787);

const flag = (name) => ['true', '1'].includes(process.env[name] ?? '');

/** NETLIFY is set in builds and deployed functions; NETLIFY_DEV only under `netlify dev`. */
export const IS_NETLIFY = flag('NETLIFY');
export const IS_NETLIFY_DEV = flag('NETLIFY_DEV');

/**
 * `blobs` works on Netlify (ephemeral filesystem); `disk` works for local and
 * Docker runs. `netlify dev` uses disk by default because Blobs needs a linked
 * site's credentials, which a fresh checkout does not have. To exercise Blobs
 * locally, run `netlify link` and set NETFILESHARE_STORE=blobs.
 */
export const STORE_DRIVER = (process.env.NETFILESHARE_STORE || (IS_NETLIFY ? 'blobs' : 'disk')).toLowerCase();

export const BLOB_STORE_NAME = process.env.NETFILESHARE_BLOB_STORE || 'netfileshare';

// `netlify dev` keeps the hosted 4 MB cap so the limit can be tried locally.
const DEFAULT_MAX_UPLOAD_MB = STORE_DRIVER === 'blobs' || IS_NETLIFY || IS_NETLIFY_DEV ? 4 : 100;

/**
 * Netlify Functions reject request bodies above roughly 6 MB, so the hosted
 * build caps uploads well under that and reports a clear error instead of
 * failing with an opaque 502.
 */
export const MAX_UPLOAD_BYTES = Math.floor(
  Number(process.env.NETFILESHARE_MAX_UPLOAD_MB || DEFAULT_MAX_UPLOAD_MB) * 1024 * 1024,
);

export const MAX_UPLOAD_FILES = Number(process.env.NETFILESHARE_MAX_UPLOAD_FILES || 25);

/** Notes are kept inside their metadata record, so the ceiling stays modest. */
export const MAX_NOTE_BYTES = Number(process.env.NETFILESHARE_MAX_NOTE_KB || 256) * 1024;

/**
 * How long a new workspace or note lives, and how much an "extend" adds.
 * Seven days suits a tool used across a working week; the client reads the
 * real value from /api/health so every label matches whatever is configured.
 */
export const LIFETIME_HOURS = Math.max(
  Number(process.env.NETFILESHARE_LIFETIME_HOURS || 24 * 7) || 24 * 7,
  1,
);

export const WORKSPACE_LIFETIME_MS = LIFETIME_HOURS * 60 * 60 * 1000;

export const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

export function describeLimits() {
  return {
    store: STORE_DRIVER,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    maxUploadFiles: MAX_UPLOAD_FILES,
    maxNoteBytes: MAX_NOTE_BYTES,
    lifetimeMs: WORKSPACE_LIFETIME_MS,
  };
}
