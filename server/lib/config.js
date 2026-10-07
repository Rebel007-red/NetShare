import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Not named __dirname: Netlify's bundler injects its own __dirname shim into
// function bundles, and redeclaring it is a SyntaxError that 500s every request.
// The fallback covers bundles where import.meta.url is undefined.
const moduleDir = import.meta.url
  ? path.dirname(fileURLToPath(import.meta.url))
  : path.join(process.cwd(), 'server', 'lib');

export const ROOT_DIR = path.resolve(moduleDir, '..', '..');
export const DATA_DIR = process.env.NETFILESHARE_DATA_DIR || path.join(ROOT_DIR, 'server-data');
export const STORAGE_DIR = process.env.NETFILESHARE_STORAGE_DIR || path.join(ROOT_DIR, 'storage');
export const DIST_DIR = path.join(ROOT_DIR, 'dist');

export const PORT = Number(process.env.NETFILESHARE_PORT || 8787);

const flag = (name) => ['true', '1'].includes(process.env[name] ?? '');

export const IS_NETLIFY_DEV = flag('NETLIFY_DEV');

/**
 * NETLIFY=true is only guaranteed during builds; it is not reliably present in
 * the deployed function runtime, which is where the disk driver would fail on
 * the read-only filesystem. So also look for what the runtime does set: the
 * Blobs context, or the AWS Lambda markers Netlify Functions run under.
 * `netlify dev` sets NETLIFY_DEV and is treated separately.
 */
export const IS_NETLIFY = !IS_NETLIFY_DEV && (
  flag('NETLIFY')
  || Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
  || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME)
  || Boolean(process.env.LAMBDA_TASK_ROOT)
);

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

/**
 * Optional team passphrase. When set, creating a workspace, link or note needs it;
 * using one you hold the code for does not (the code is the access key).
 */
export const ACCESS_KEY = process.env.NETFILESHARE_ACCESS_KEY || '';

export const RATE_LIMIT_ENABLED = (process.env.NETFILESHARE_RATE_LIMIT || 'on').toLowerCase() !== 'off';
export const RATE_CREATE_PER_HOUR = Number(process.env.NETFILESHARE_RATE_CREATE_PER_HOUR || 60);
export const RATE_UPLOAD_PER_HOUR = Number(process.env.NETFILESHARE_RATE_UPLOAD_PER_HOUR || 300);
/** Failed lookups (unknown codes, wrong PINs or passphrases) per client per 10 minutes. */
export const RATE_MISS_PER_10_MIN = Number(process.env.NETFILESHARE_RATE_MISS_PER_10_MIN || 60);

/**
 * Whose X-Forwarded-For to believe. Left at 'loopback', a client talking to the
 * server directly cannot spoof its address to dodge the rate limits; set it to
 * 'true' or an address list only when a real reverse proxy sits in front.
 */
function parseTrustProxy(value) {
  const raw = String(value ?? 'loopback').trim();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}
export const TRUST_PROXY = parseTrustProxy(process.env.NETFILESHARE_TRUST_PROXY);

/** Folder ZIPs are built in the function, so the hosted build keeps them small. */
export const MAX_ZIP_BYTES = Math.floor(
  Number(process.env.NETFILESHARE_MAX_ZIP_MB || (IS_NETLIFY || IS_NETLIFY_DEV ? 20 : 500)) * 1024 * 1024,
);

export function describeLimits() {
  return {
    store: STORE_DRIVER,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    maxUploadFiles: MAX_UPLOAD_FILES,
    maxNoteBytes: MAX_NOTE_BYTES,
    lifetimeMs: WORKSPACE_LIFETIME_MS,
    accessRequired: Boolean(ACCESS_KEY),
    maxZipBytes: MAX_ZIP_BYTES,
  };
}
