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
| Live editing | `/note/<CODE>?edit=1`, same code as the note | a per-note switch, not a new code |

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
- Two things sit *around* the model without replacing it: an optional **team passphrase**
  that guards only *creating* things (see "Access, limits and PINs"), and an optional
  **per-item PIN** for the rare share that needs a second factor. With neither configured,
  the code is still the whole story.
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
- `netlify/functions/api.js` — the same app behind a Netlify-format handler

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
    liveSync.js          diff-match-patch helpers for live editing (client half)
  hooks/
    useLiveNote.js       the live-editing sync loop (polling, merge, caret, presence)
  services/
    apiClient.js         fetch wrapper, formatters, /api/health cache
    recentStore.js       localStorage "recent codes" (defensive everywhere)
    workspaceService.js  | linkService.js | noteService.js
    backupService.js     export / restore of this browser's remembered codes
  components/            UI; see "UI conventions" below (LiveDocument.jsx = live editor)
  app.css                all styles (tokens, mobile-first, dark mode)

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
    access.js            team passphrase check (creating things only)
    rateLimit.js         fixed-window per-address counters
    pin.js               scrypt PIN hashing, unlock-cookie helpers
    activity.js          bounded per-record activity log
    noteVersions.js      saved earlier texts of a note (separate record)
    zip.js               streaming ZIP writer (deflate, one file in memory at a time)
  routes/pin.js          the shared PIN gate + /unlock + /pin routes

test/                    node:test suites + helpers (npm test); one process per file
.github/workflows/ci.yml lint + build + test on Node 20 and 22
public/                  icons, manifest.webmanifest, sw.js (install only, caches nothing)

netlify/functions/
  api.js                 Netlify-format handler -> loopback Express
  cleanup.js             hourly expiry sweep (schedule in its own config)
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

## Access, limits and PINs

All three are optional and configured by environment variable; with none set the app
behaves exactly like the original share-code model.

| Variable | Default | Effect |
|---|---|---|
| `NETFILESHARE_ACCESS_KEY` | unset | Team passphrase. Needed to **create** workspaces, links and notes; **not** needed to use something you hold the code for. |
| `NETFILESHARE_RATE_LIMIT` | `on` | `off` disables all limiting (tests do this). |
| `NETFILESHARE_RATE_CREATE_PER_HOUR` | 60 | Creates per address. |
| `NETFILESHARE_RATE_UPLOAD_PER_HOUR` | 300 | Upload/folder requests per address. |
| `NETFILESHARE_RATE_MISS_PER_10_MIN` | 60 | Failed lookups (unknown codes, wrong PINs/passphrases) per address before it is shut out. |
| `NETFILESHARE_TRUST_PROXY` | `loopback` | Whose `X-Forwarded-For` to believe. Leave it alone unless a real reverse proxy is in front. |
| `NETFILESHARE_MAX_ZIP_MB` | 500 (20 on Netlify) | Largest folder ZIP. |

Why the shapes are what they are:

1. **The passphrase gates creation, not use.** Creating is what spends storage; using a
   share code is decision 1. The client prompts once (`window.prompt`, like rename),
   verifies it via `POST /api/access`, keeps it in localStorage, and retries.
2. **Guessing codes is the attack, so misses are counted.** Every 404, wrong PIN and
   wrong passphrase counts against the caller (`res.locals.miss`); over the limit they
   get 429 *before* any record is read. A `pin_required` answer is deliberately **not** a
   miss, otherwise listing a few locked items would lock you out.
3. **The client address is not a header the caller controls.** `trust proxy` defaults to
   `loopback`, and the Netlify function overwrites `X-Forwarded-For` with Netlify's own
   `x-nf-client-connection-ip` / `context.ip` before forwarding. Test:
   `test/ratelimit.test.js` and the forged-header check.
4. **Counters are per process.** Exact on Node/Docker; on Netlify each function instance
   counts separately, so treat it as abuse friction, not a hard quota.
5. **PIN = cookie, not header.** A header cannot be sent by an `<a href>` download, an
   `<img>` preview or a ZIP link. `POST /unlock` sets an `HttpOnly` cookie holding
   `sha256(pinHash:code)`, so it cannot be forged and changing the PIN invalidates every
   cookie already issued. The PIN is salted scrypt; the hash never leaves the server
   (presenters expose only `hasPin`).
6. **A locked item is not a missing item.** Lists load with `interactive: false`; a
   `pin_required` answer becomes a locked placeholder with an **Unlock** button, so the
   code is not pruned from the remembered list and there is no wall of prompts.
7. Anyone who can open an item can set or clear its PIN, exactly as they can delete it.
   The PIN protects against people who only have the code, not against someone already in.

## Versions, activity, ZIP, backup, expiry warnings, install

- **Version history** (`noteVersions.js`): earlier texts live in their own record
  (`note-versions/<CODE>`), never in the note, so the live-edit poll does not load them.
  Saved before a full replace, before a restore, every 2 minutes during live edits, and
  **immediately before an edit that deletes a lot** (over 500 bytes and 30%). Max 20 per
  note and 3 MB of text. A restore saves the text it replaces, so it is itself undoable.
  Versions are deleted with the note, including when it expires lazily.
- **Activity log** (`activity.js`): a bounded list *inside* the record (40 entries), so it
  costs no extra storage call. It records what and when, **never who** (no accounts).
  Bursts of the same kind collapse into one line with a count (`coalesce`).
- **Folder ZIP** (`zip.js`): hand-written baseline ZIP (no ZIP64, no dependency), streamed
  with one file in memory at a time. Capped by `NETFILESHARE_MAX_ZIP_MB` with a clear 413.
  `test/zip.test.js` reads the result with an *independent* parser that checks CRCs.
- **Per-file uploads**: the client sends one request per file. Netlify caps a whole
  request near 6 MB, so sending files together could fail even when each was under the
  4 MB limit. A partial failure reports "Uploaded N of M".
- **Filenames are UTF-8**: multer defaults to latin1 and turned `ünï.txt` into mojibake;
  `defParamCharset: 'utf8'` fixes it. Do not remove it.
- **Backup/restore** (`backupService.js`): codes only, no content. Restoring probes each
  code non-interactively and reports what expired. Six-character codes are shared by
  workspaces and notes, so loose pasted codes are tried against both.
- **Expiry warnings**: a banner and a red badge when something expires within
  `min(24 h, lifetime/4)`, with a one-click Extend. Links are excluded (no extend API).
- **Installable**: `public/manifest.webmanifest` + `sw.js`. The worker **caches nothing**
  on purpose; do not add caching without thinking about stale code and live share codes.
  It registers in production builds only, so it never sits in front of Vite.

## Live editing (shared notes)

A note can be switched to **live editing** (`isCollaborative`). Anyone with the code
can then edit it together, which fits decision 1: the code is already full control.

**How it works — near-live polling, not WebSockets.** Netlify Functions cannot hold a
socket open, and the same code has to run on Node, Docker and Netlify, so there is no
socket transport. Instead each editor repeatedly calls `POST /api/notes/<CODE>/sync`:

- The client keeps `base`, the last text the server confirmed, and sends only the
  **diff from base to what it has now** (`diff-match-patch` patch text), plus its
  revision.
- The server (`syncNote` in `server/lib/notes.js`) applies that patch fuzzily onto the
  *current* text under the per-key lock, bumps `rev`, and returns the merged text.
  Edits in different places merge; same-spot inserts both survive.
- Anything the user typed while the request was in flight is re-applied on top of the
  reply, and the caret is mapped through the change so remote edits above it do not
  make it jump (`useLiveNote.js`).
- A hunk whose surroundings were rewritten is dropped and counted in `rejected`; the UI
  shows a notice with a **Copy my version** button. Never silently swallow it.

Things that are easy to break:

1. **Every request carries an `opId`**; the server remembers the last 40. A retry after
   a lost response must not apply a patch twice (it would duplicate inserted text).
2. **A patch reply always includes the text**, even if nothing changed. Otherwise a
   fully rejected patch leaves `rev` alone and the client would resend it forever.
3. **Presence** is a `clientId → lastSeen` map on the note record, refreshed at most
   every 6 s per editor and counted within 15 s. It stores no names (there is no login).
   Viewers poll with `viewer: true` and are not counted.
4. **Full-replace `PATCH` also bumps `rev`**, so open editors pick it up. The in-card
   "Edit" form is hidden for live notes; they are edited through the live editor only.
5. **Turning it off** makes `/sync` answer 409; editors stop polling and say so.
6. The JSON body limit is `3 × MAX_NOTE_BYTES` because patch text percent-encodes
   newlines and non-ASCII. `liveSync.js` and `notes.js` must keep the same
   `Match_*` settings.
7. **Polling costs function invocations** on Netlify. The interval is 1.5 s while
   anyone is active, backing off to 5 s then 12 s when idle, 15 s in a hidden tab, and
   2.5× slower for read-only viewers. Ten people editing continuously is on the order
   of 20k invocations an hour; check the plan's quota before leaving editors open.
8. Same accepted limit as decision 3: the lock is per process, so two Netlify instances
   writing one note at the same moment can lose an update. Fine at 5–10 users.

## Netlify specifics

The function uses **Netlify's current format** — `export default (request) => Response`
plus `export const config` — not the Lambda-compatible `(event, context)` one. This
is not a style choice: only the current format gets the full Blobs credentials. The
Lambda form's `connectLambda()` context has no `uncachedEdgeURL`, which
`consistency: 'strong'` requires, so every read-after-write throws. That mismatch is
what made a deployed site answer "Unexpected server error" on every write.

Points that are easy to break:

1. **Routing lives in the function, not `netlify.toml`.** `config.path` declares
   `/api/*` and `/s/*`, so Express sees the caller's real path and no rewrite or
   path-normalization step is needed. `netlify.toml` only keeps the SPA fallback.
2. **Express runs behind a loopback server.** `createApp()` listens on port 0 once
   per cold start and the handler forwards each request to it, because Express needs
   a Node request, not a `Request`. Responses stream back untouched, which is what
   keeps downloads byte-exact — the old `serverless-http` + `binary: true` base64
   round trip is gone.
3. **Forward with `node:http`, not `fetch`.** On an oversize upload Express answers
   413 and closes the socket mid-body; `fetch` turns that into an opaque
   "fetch failed", while `node:http` still delivers the 413.
4. **Request bodies are buffered, responses are not.** Netlify caps bodies near 6 MB
   anyway, and buffering lets `content-length` be set correctly for Express.
5. **`external_node_modules`** keeps `express` and `multer` as real `node_modules`
   rather than esbuild-inlined, because they are CommonJS with dynamic requires.
6. **4 MB upload cap.** Netlify Functions reject bodies over roughly 6 MB. The cap is
   deliberate and confirmed as acceptable; the error is a clean 413, not an opaque
   502. Lifting it means presigned direct-to-storage uploads against S3/R2 — that is
   the only real path, and it replaces the Blobs driver for bytes.
7. **Driver selection cannot rely on `NETLIFY=true`.** That is set during builds but
   not reliably in the function runtime, so `disk` was being chosen on a deployed
   site. `config.js` also checks `NETLIFY_BLOBS_CONTEXT` and the Lambda markers.
8. **Never declare `__dirname`.** Netlify's bundler injects its own shim; redeclaring
   it is a `SyntaxError` that 500s every request. `config.js` uses `moduleDir`, and
   guards `import.meta.url` since it is undefined in a CommonJS bundle.
9. **`netlify dev` uses the `disk` store** (Blobs needs a linked site's credentials)
   but keeps the 4 MB cap. To try Blobs locally: `netlify link`, then set
   `NETFILESHARE_STORE=blobs`. Port 8888 must be free; a stale `netlify dev` holds it.
10. **Dev-server pitfalls (both caused a blank page):** Vite proxy keys must be
   anchored regexes (`'^/s/'`, not `'/s'`) — a bare `/s` also proxies
   `/src/main.jsx`. And `[dev] framework = "#custom"` in `netlify.toml` is required
   so the `/* → /index.html` SPA rule does not answer Vite's module requests with
   HTML.
11. `Content-Length` is deliberately **not** set on file responses. Trusting stored
   metadata would truncate or hang the response if the two disagreed.

## UI conventions

- Class names are `nfs-` prefixed BEM-ish. New styles go in `src/app.css`.
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
npm test             # node:test suites in test/ (no browser needed)
npm install          # also regenerates the stale lockfile (see below)
npm run dev:all      # Vite + API together; Vite proxies /api and /s to :8787
npm run lint
npm run build
npm run start:prod   # build, then serve everything from Express on :8787
npm run netlify:dev  # Netlify redirects, functions and a local Blobs sandbox
npm run docker:up    # app + API on :8787 with persistent volumes
```

## Current state — read this

**Verified on Node 22:** `npm install`, `npm run lint` (0 errors; 5 `set-state-in-effect`
warnings), `npm run build` and `npm test` all succeed. `npm test` is server-side only and
runs in CI on Node 20 and 22; the browser flows were checked by hand with Edge via
playwright-core and are **not** automated in the repo. An end-to-end browser run (Edge via
playwright-core) passed: create workspace, upload, download, folder create, short link
create + 302 redirect, `javascript:` URL rejected, note create + render with script
stripped, and an oversize upload returning 413.

**Styling:** one mobile-first stylesheet, `src/app.css`. Colours are tokens on `:root`
and dark mode (system setting) is a token swap. Below 720px the tabs become a fixed
bottom bar and card action buttons become an equal-width grid; from 720px up the tabs
sit in the top bar. Inputs are 16px so iOS does not zoom on focus. Grid containers use
`minmax(0, 1fr)` columns so a long file name cannot widen the page.

**`package-lock.json` is current** — it was regenerated by `npm install` once Node
was available, so `npm ci` works. The Dockerfile still uses `npm install`.

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

1. Presigned direct-to-storage uploads, if 4 MB turns out to pinch. Or run the Docker
   build, where the cap is 100 MB. This is mostly a hosting decision.
2. SQLite or Postgres for metadata, if concurrent writes ever actually collide. This
   would also make the per-process rate limits and PIN cache exact across instances.
3. Automated browser tests (playwright) for the flows currently checked by hand.
4. Per-workspace storage quotas.
5. Edge rate limiting in front of Netlify, if the per-instance counters prove too loose.
