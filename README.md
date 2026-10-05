# NetFileShare

A compact React + Node app for sharing three things through short codes:

- **Files and folders** in a workspace, behind a 6-character code
- **Short links** under `/s/<slug>`, with click counts, custom aliases and QR codes
- **Text and document notes** under `/note/<CODE>`, with markdown rendering and syntax highlighting

It deploys two ways from one codebase: as a long-running Node server (local or Docker)
or as a static frontend plus one Netlify Function.

## Features

### Files

- Create workspaces with human-friendly 6-character codes
- Join by code, or open an invite link (`/w/<CODE>`)
- Default 7-day lifetime, extendable, or pinned to never expire
- Nested folders, drag-and-drop upload, multi-file upload
- Rename and delete files, folders (recursively) and whole workspaces
- Download files; inline previews for images
- Per-file and per-workspace QR codes

### Short links

- Auto-generated 7-character slug, or a custom alias
- Optional label and optional expiry date
- Click counter and last-visited timestamp
- Retarget an existing short code without changing its URL
- Downloadable QR code per link
- Destinations are restricted to `http`, `https` and `mailto`

### Notes

- Markdown (rendered), plain text, or code with syntax highlighting
- Rendered / raw toggle, copy to clipboard, download as a file
- Standalone share page at `/note/<CODE>` that needs nothing but the link
- Same expiry model as workspaces: 7 days, extendable, or permanent
- View counter

## Architecture

```text
src/                     React frontend (Vite)
  lib/                   markdown rendering, highlighting, routing
  services/              API clients and localStorage "recent codes"
  components/            UI
server/
  app.js                 the Express app — the single API implementation
  index.js               local / Docker entry point (listens, serves dist)
  routes/                HTTP layer
  lib/                   domain logic, validation, storage drivers
    store/disk.js        filesystem driver (local, Docker)
    store/blobs.js       Netlify Blobs driver (Netlify)
netlify/functions/
  api.js                 wraps server/app.js with serverless-http
  cleanup.js             scheduled expiry sweep
```

The API exists once. `server/index.js` runs it with `app.listen`;
`netlify/functions/api.js` runs the same app inside a Netlify Function.

### Storage

A single `Store` interface has two drivers, chosen by `NETFILESHARE_STORE`
(defaulting to `blobs` on Netlify and `disk` everywhere else):

| | `disk` | `blobs` |
|---|---|---|
| Metadata | `server-data/<kind>/<code>.json` | Netlify Blobs under `meta/` |
| File bytes | `storage/files/<wsId>/<itemId>` | Netlify Blobs under `blob/` |
| Used by | local, `start:prod`, Docker | Netlify |

Two design points worth knowing:

1. **One record per key.** The previous version rewrote a single
   `workspaces.json` on every request, so concurrent writes lost data. Records
   are now keyed individually and each key's read-modify-write cycle is
   serialized by an in-process lock.
2. **File bytes are keyed by item id, never by path.** The logical path lives
   only in metadata. A rename therefore touches no bytes, and no
   caller-supplied string ever reaches a filesystem path.

## Run locally

```bash
npm install
```

Frontend and API together:

```bash
npm run dev:all
```

The Vite dev server proxies `/api` and `/s` to `http://localhost:8787`.

Separately, if you prefer:

```bash
npm run dev:api
```

```bash
npm run dev
```

Production-style, served entirely from Express on port 8787:

```bash
npm run start:prod
```

## Deploy to Netlify

The repo is Netlify-ready — `netlify.toml` wires everything up.

1. Connect the repo in Netlify. Build command and publish directory are read
   from `netlify.toml` (`npm run build` → `dist`).
2. Deploy. No environment variables are required: Netlify Blobs is
   provisioned per site automatically and needs no keys.

What `netlify.toml` sets up:

- `/api/*` and `/s/*` rewrite to the `api` function
- Everything else falls back to `index.html` for the SPA
- `cleanup` runs hourly as a scheduled function to reclaim expired storage
- Security headers and long-lived caching for hashed assets

To run the Netlify setup locally (functions, Blobs sandbox and redirects
included):

```bash
npm run netlify:dev
```

### Netlify upload limit

Netlify Functions reject request bodies above roughly 6 MB, so the hosted build
caps uploads at **4 MB per file** and reports that clearly rather than failing
with an opaque 502. The frontend reads the active limit from `/api/health`, so
the message always matches the deployment.

The self-hosted path has no such restriction and defaults to 100 MB per file.
If you need large files on Netlify, the next step is presigned direct-to-storage
uploads against S3 or R2, which would replace the Blobs driver for file bytes.

## Run with Docker

```bash
npm run docker:up
```

Serves app and API on port `8787`, with `netfileshare-storage` and
`netfileshare-data` volumes and a healthcheck against `/api/health`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `NETFILESHARE_PORT` | `8787` | Port for the Node server |
| `NETFILESHARE_STORE` | `blobs` on Netlify, else `disk` | Storage driver |
| `NETFILESHARE_MAX_UPLOAD_MB` | `4` with Blobs, `100` with disk | Per-file upload limit |
| `NETFILESHARE_MAX_UPLOAD_FILES` | `25` | Files per upload request |
| `NETFILESHARE_MAX_NOTE_KB` | `256` | Note size limit |
| `NETFILESHARE_LIFETIME_HOURS` | `168` (7 days) | Lifetime of a new workspace or note, and the amount one "extend" adds |
| `NETFILESHARE_DATA_DIR` | `./server-data` | Metadata directory (disk driver) |
| `NETFILESHARE_STORAGE_DIR` | `./storage` | File directory (disk driver) |
| `NETFILESHARE_BLOB_STORE` | `netfileshare` | Netlify Blobs store name |

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness plus the active limits |
| `POST` | `/api/workspaces` | Create a workspace |
| `GET` | `/api/workspaces/:code` | Read a workspace |
| `PATCH` | `/api/workspaces/:code` | Rename |
| `DELETE` | `/api/workspaces/:code` | Delete workspace and files |
| `POST` | `/api/workspaces/:code/extend` | Add another lifetime period |
| `POST` | `/api/workspaces/:code/persistence` | Toggle never-expiring |
| `POST` | `/api/workspaces/:code/folders` | Create a folder |
| `POST` | `/api/workspaces/:code/files` | Upload (multipart `files`) |
| `PATCH` | `/api/workspaces/:code/items/rename` | Rename an item and its subtree |
| `DELETE` | `/api/workspaces/:code/items?path=` | Delete an item and its subtree |
| `GET` | `/api/workspaces/:code/download?path=` | Download a file |
| `GET` | `/api/workspaces/:code/file?path=` | Inline file (sandboxed) |
| `POST` | `/api/links` | Create a short link |
| `GET` | `/api/links/:slug` | Read link metadata and clicks |
| `PATCH` | `/api/links/:slug` | Retarget, relabel, change expiry |
| `DELETE` | `/api/links/:slug` | Delete |
| `GET` | `/s/:slug` | Redirect and count the click |
| `POST` | `/api/notes` | Create a note |
| `GET` | `/api/notes/:code` | Read a note |
| `GET` | `/api/notes/:code/raw` | Plain text (`?download=1` to attach) |
| `PATCH` | `/api/notes/:code` | Edit |
| `POST` | `/api/notes/:code/extend` | Add another lifetime period |
| `POST` | `/api/notes/:code/persistence` | Toggle never-expiring |
| `DELETE` | `/api/notes/:code` | Delete |

## Security posture

There is deliberately no authentication layer: **the share code is the access
key**, and anyone holding it has full control of that workspace, note or link.
That is the internal-use assumption this app is built on. Within it, the
following are enforced:

- Share codes and slugs come from `crypto.randomInt`, not `Math.random`
- Path segments reject `..`, separators, control characters and reserved names;
  file bytes are keyed by item id so no path is ever derived from input
- Upload size and file-count limits, with clear 413 responses
- Short-link destinations are restricted to `http`/`https`/`mailto`, which stops
  a stored `javascript:` URL from turning every link into an XSS vector
- Note markdown is sanitized with DOMPurify; links are forced to safe protocols
  and `rel="noopener noreferrer nofollow"`
- Inline file responses carry `X-Content-Type-Options: nosniff`, a restrictive
  `Content-Security-Policy` and `sandbox`; SVGs are never previewed inline
- Stored content is served `Cache-Control: private`
- Server errors return a generic message; details stay in the logs

Remaining limitations:

- No user accounts, so no per-user access control or audit trail
- The write lock is per process. A single Node server or a single Netlify
  function instance is safe; concurrent writes to the *same* record from two
  instances can still lose an update
- Metadata is JSON records rather than a database

## Migration note

The storage layout changed: metadata moved from one `server-data/workspaces.json`
array to per-record files, and file bytes moved from `storage/<wsId>/<path>` to
`storage/files/<wsId>/<itemId>`. **Existing local data is not read by this
version.** Delete `server-data/` and `storage/` (or let the old workspaces
simply go unreferenced) before the first run.

## Good next implementation steps

1. Presigned direct-to-storage uploads so Netlify is not capped at 4 MB.
2. Move metadata to SQLite or Postgres and get real transactions.
3. Per-workspace storage quotas.
4. Optional password protection on a workspace, note or link.
5. Activity logging for uploads, deletes and expiry changes.
6. ZIP download of a whole folder.
