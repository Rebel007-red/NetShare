# CLAUDE.md

Working notes for anyone (human or agent) picking up NetFileShare. Read this
before changing code; it records *why* things are shaped the way they are, which
the code itself does not say.

## What this is

A small internal sharing tool with three features behind short codes:

| Feature | Share surface | Code shape |
|---|---|---|
| Files and folders | `/w/<CODE>` invite link, or join by code | 6 chars, `[A-Z1-9]` |
| Short links | `/s/<slug>` redirect | 7 chars, or a custom alias |
| Text / doc notes | `/note/<CODE>` read page | 6 chars, `[A-Z1-9]` |

Target scale is **5–10 internal users**. That number is a real design input, not
a disclaimer — several decisions below are correct only at that size and are
called out where that matters.

## Non-negotiable design decisions

These were deliberate. Changing one means re-reading this section first.

### 1. The share code is the access key. There is no auth layer.

Anyone holding a code has **full** control of that workspace/note/link,
including delete. This was confirmed as the intended model. Consequences:

- Codes come from `crypto.randomInt` (`server/lib/ids.js`), never `Math.random`,
  because guessing a code is the whole attack.
- The alphabet omits `I`, `O` and `0` so codes survive being read aloud.
- Do not add a feature that leaks codes (e.g. a "list all workspaces" endpoint).
  The only enumeration is the browser's own localStorage list.

### 2. File bytes are keyed by item id, never by a path.

`server/lib/store/index.js` → `fileKeyFor(workspaceId, itemId)` →
`files/<wsId>/<itemId>`. The logical path (`/docs/spec.pdf`) lives **only** in
metadata.

This is the structural fix for the path-traversal bug the first version had, and
it is worth more than the input validation on top of it: no caller-supplied
string is ever concatenated into a storage path, so there is nothing to escape.
It also makes rename a pure metadata operation — no bytes move.

`server/lib/paths.js` still validates path segments (rejects `..`, separators,
control characters, Windows reserved names, caps depth at 24 and names at 120
chars), because paths are echoed back to clients and used for uniqueness checks.

**If you add a storage driver, keep this property.** Do not "simplify" by
storing files under their display path.

### 3. One record per storage key, plus a per-key lock.

The first version kept every workspace in a single `server-data/workspaces.json`
array and rewrote the whole file per request, so two concurrent uploads lost each
other's work. Now:

- Each record is its own key: `workspaces/<CODE>`, `links/<slug>`, `notes/<CODE>`
- `server/lib/store/mutex.js` serializes read-modify-write per key
- The disk driver writes to a temp file and renames, so a crash mid-write cannot
  leave a half-written record

**Known limit, accepted at this scale:** the lock is per process. One Node
server or one Netlify function instance is safe. Two function instances writing
the *same* record can still lose an update. At 5–10 users this will not happen in
practice. If usage grows, that is the trigger to move metadata to SQLite or
Postgres — not a reason to make the lock cleverer.

### 4. The API exists exactly once.

`server/app.js` exports `createApp()`. Two things run it:

- `server/index.js` — `app.listen`, plus static `dist` serving (local, Docker)
- `netlify/functions/api.js` — the same app wrapped in `serverless-http`

Do not fork route logic per deployment target. If something must differ, it goes
behind a config value in `server/lib/config.js`.

### 5. Two storage drivers behind one interface.

Netlify Functions have an ephemeral, read-only filesystem, so disk storage
cannot work there. `NETFILESHARE_STORE` picks the driver (`blobs` on Netlify,
`disk` elsewhere):

| | `disk` | `blobs` |
|---|---|---|
| Metadata | `server-data/<kind>/<code>.json` | Netlify Blobs, `meta/` prefix |
| File bytes | `storage/files/<wsId>/<itemId>` | Netlify Blobs, `blob/` prefix |

Netlify Blobs needs **no credentials** — it is provisioned per site. That is why
it was chosen over S3/R2. It is created with `consistency: 'strong'` because a
read immediately after a write must see the write.

### 6. Limits are served to the client, never hard-coded in the UI.

`GET /api/health` returns `describeLimits()`. The frontend reads it once
(`getServerLimits()` in `src/services/apiClient.js`) and renders every limit and
duration from it. So "Each file must be 4 MB or smaller" and "Extend 7 days"
follow the deployment's actual config.

**Do not write a number or a duration into UI copy.** Use `limits.maxUploadBytes`
/ `limits.lifetimeMs` with `formatBytes` / `formatDuration`.

### 7. Untrusted content is treated as untrusted.

- Note markdown → `marked` → **DOMPurify** with an allowlist
  (`src/lib/markdown.js`). Links are forced to `http`/`https`/`mailto` and get
  `rel="noopener noreferrer nofollow"`.
- Code notes → `highlight.js`, which escapes everything it emits. That is the
  only reason `dangerouslySetInnerHTML` is acceptable in `NoteContent.jsx`.
- Short-link targets → `http`/`https`/`mailto` only (`server/lib/links.js`).
  Without this, a stored `javascript:` URL makes every short link an XSS vector.
- Inline file previews → `X-Content-Type-Options: nosniff`, a restrictive CSP
  with `sandbox`, and `Cache-Control: private`.
- **SVGs are never previewed inline** (`isImageFile` in `WorkspaceHome.jsx`
  excludes them) because they can carry script.

## Layout

```text
src/
  App.jsx                orchestrator: tabs, routing, all mutation handlers
  lib/
    markdown.js          marked + DOMPurify
    highlight.js         highlight.js core + 19 explicitly registered languages
    router.js            pathname router for /note/<CODE> and /w/<CODE>
  services/
    apiClient.js         fetch wrapper, formatters, /api/health cache
    recentStore.js       localStorage "recent codes" (defensive everywhere)
    workspaceService.js  | linkService.js | noteService.js
  components/            UI; see "UI conventions" below
  index.css              original layout
  styles/features.css    everything added for tabs / links / notes

server/
  app.js                 createApp() — the single API
  index.js               local & Docker entry (listen + serve dist + cleanup loop)
  routes/                HTTP layer only: parse, validate, delegate, respond
  lib/
    config.js            every tunable, read from env
    errors.js            HttpError + badRequest/notFound/conflict/payloadTooLarge
    ids.js               crypto codes, slugs, reserved-slug list
    paths.js             logical path validation
    time.js              expiry maths
    records.js           load/require/mutate/list with lazy expiry purge
    workspaces.js | links.js | notes.js    domain logic
    store/               disk.js | blobs.js | index.js | mutex.js

netlify/functions/
  api.js                 serverless-http wrapper + path normalization
  cleanup.js             hourly scheduled expiry sweep
```

**Layering rule:** `routes/` must not touch `store/` for metadata. It calls
`lib/<domain>.js`, which calls `records.js`, which calls the store. Routes do
touch the store directly for *file bytes*, which is intentional.

## Expiry model

- New workspaces and notes live `NETFILESHARE_LIFETIME_HOURS` (default 168 = 7 days)
- "Extend" adds the same period, counted from `max(now, current expiry)`, so
  extending early does not lose time (`extendFrom` in `lib/time.js`)
- `isPersistent` pins a record; leaving permanent mode restarts the clock rather
  than reviving a past deadline
- Short links default to **never expiring** — an expiry is opt-in, because that
  is how people expect a short link to behave
- Expiry is enforced **lazily on access** (`records.js` → `loadRecord` deletes an
  expired record and reports it as absent). The scheduled/interval sweep only
  reclaims storage for codes nobody returns to, so a missed sweep is harmless

## Netlify specifics

`netlify.toml` does all the wiring. Points that are easy to break:

1. **`/api/*` and `/s/*` both rewrite to the one `api` function.** Everything
   else falls back to `index.html`.
2. **Path normalization matters.** `netlify/functions/api.js` prefers
   `event.rawUrl` (always the caller's original URL) and only falls back to
   undoing the `/.netlify/functions/api` rewrite prefix. Express needs the
   original path; getting this wrong 404s the whole API.
3. **`binary: true`** on `serverless-http` base64-encodes every response.
   Netlify decodes it. Without this, file downloads are corrupted by a UTF-8
   round trip.
4. **`external_node_modules`** keeps `express` and `multer` as real
   `node_modules` rather than esbuild-inlined, because they are CommonJS with
   dynamic requires.
5. **4 MB upload cap.** Netlify Functions reject bodies over roughly 6 MB. The
   cap is deliberate and confirmed as acceptable. The error is a clean 413, not
   an opaque 502. Lifting it means presigned direct-to-storage uploads against
   S3/R2 — that is the only real path, and it replaces the Blobs driver for
   bytes.
6. `Content-Length` is deliberately **not** set on file responses. Trusting
   stored metadata would truncate or hang the response if the two disagreed.

## UI conventions

- Class names are `nfs-` prefixed BEM-ish. New feature styles go in
  `src/styles/features.css`, which loads **after** `index.css` so it can override.
- All hooks are called before any early return (oxlint enforces
  `react/rules-of-hooks`).
- Destructive actions confirm via `window.confirm` — consistent with the existing
  `window.prompt` rename flow. Don't mix in a custom modal for one action.
- Copy-to-clipboard confirms **inline** on the button (`ShareCodeField`), not via
  a toast, because copying is high-frequency.
- `copyToClipboard` falls back to the legacy `execCommand` path; the Clipboard
  API is blocked in some contexts.
- Every `localStorage` access is wrapped in try/catch — it throws in private
  windows and when site data is blocked.
- Forms that can fail (join, create) only close/reset **after** success. The old
  join form closed on failure, which hid the error.

## Gotchas discovered the hard way

- **`input.files` is live.** Copy it to an array *before* setting
  `input.value = ''`, or the upload gets an empty list.
- `highlight.js` must be imported as `highlight.js/lib/core` with languages
  registered explicitly. The full build is close to a megabyte and would dominate
  the bundle.
- `presentWorkspace` / `presentNote` / `presentLink` exist so internal fields
  never leak to clients. Add new fields to the presenter deliberately.
- The note list sends full note content per note. Fine at this scale; it is the
  first thing to paginate if note count or size grows.

## Commands

```bash
npm install          # also regenerates the stale lockfile (see below)
npm run dev:all      # Vite + API together; Vite proxies /api and /s to :8787
npm run lint
npm run build
npm run start:prod   # build, then serve everything from Express on :8787
npm run netlify:dev  # Netlify redirects, functions and a local Blobs sandbox
npm run docker:up    # app + API on :8787 with persistent volumes
```

## Current state — read this

**The code has never been compiled, linted or run.** The machine it was written
on has no Node installed, so `npm install`, `npm run build` and `npm run lint`
could not be executed. What *was* verified statically:

- Every relative import resolves to a real file
- Every named import matches an actual export across all 40 source files
- No unused imports
- Brackets balance (string/template/comment aware)

Not verified: JSX and type correctness, the bundle building, runtime behaviour of
any endpoint, the Netlify function wiring end to end.

**First task for whoever has Node:** `npm install && npm run lint && npm run build`,
then fix what surfaces.

**`package-lock.json` is stale** — it predates the `@netlify/blobs`, `marked`,
`dompurify`, `highlight.js`, `qrcode.react` and `serverless-http` additions.
`npm install` will refresh it. Until then `npm ci` will fail, which is why the
Dockerfile uses `npm install`.

**Storage layout changed and old data is not readable.** Metadata moved from one
`workspaces.json` array to per-record files; bytes moved from
`storage/<wsId>/<path>` to `storage/files/<wsId>/<itemId>`. Delete `server-data/`
and `storage/` before the first run.

## Decisions already made — do not re-litigate

Asked and answered during the build:

| Question | Decision |
|---|---|
| Netlify storage backend | Netlify Blobs (no credentials needed) |
| Netlify upload limit | Cap at 4 MB with a clear error, not presigned uploads |
| Shortener scope | Custom alias + click counts + optional expiry + QR |
| Note scope | Markdown rendering + syntax highlighting, raw toggle, download |
| Scale | 5–10 users; per-process lock and unpaginated lists are fine |
| Auth | None. Share code is the access key |
| Default lifetime | 7 days, extendable, pinnable |

## Next steps, in the order they will actually matter

1. Get Node installed and make the thing build. Everything else is blocked on this.
2. Presigned direct-to-storage uploads, if 4 MB turns out to pinch.
3. SQLite or Postgres for metadata, if concurrent writes ever actually collide.
4. ZIP download of a whole folder.
5. Per-workspace storage quotas.
6. Activity logging for uploads, deletes and expiry changes.
