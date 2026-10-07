import DiffMatchPatch from 'diff-match-patch';
import { presentActivity, withActivity } from './activity.js';
import { MAX_NOTE_BYTES, WORKSPACE_LIFETIME_MS } from './config.js';
import { badRequest, conflict, notFound, payloadTooLarge } from './errors.js';
import { generateCode, makeId, normalizeCode } from './ids.js';
import { addVersion, deleteVersions, getVersion } from './noteVersions.js';
import { listLiveRecords, loadRecord, mutateRecord } from './records.js';
import { getStore, recordKeys, recordPrefixes } from './store/index.js';
import { extendFrom, now, toIso } from './time.js';

const NOT_FOUND_MESSAGE = 'Note not found or expired';
const MAX_TITLE_LENGTH = 120;

export const NOTE_FORMATS = ['markdown', 'text', 'code'];

/** An editor counts as present if it synced within this window. */
const PRESENCE_WINDOW_MS = 15_000;
/** Presence is only rewritten this often per editor, to keep writes cheap. */
const PRESENCE_REFRESH_MS = 6_000;
const MAX_PRESENCE_ENTRIES = 50;
/** Remembered operation ids, so a retried request cannot apply an edit twice. */
const MAX_RECENT_OPS = 40;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,48}$/;
/** A live editor saves a version at most this often... */
const SNAPSHOT_INTERVAL_MS = 2 * 60 * 1000;
/** ...and immediately before an edit that removes this much, so a mass delete is undoable. */
const LARGE_DELETION_BYTES = 500;
const LARGE_DELETION_RATIO = 0.3;

/**
 * Concurrent edits are merged as patches against the current text. The match
 * settings are loosened from the defaults so a patch still finds its place when
 * another editor has added a few paragraphs above it.
 */
const dmp = new DiffMatchPatch();
dmp.Match_Distance = 20000;
dmp.Match_Threshold = 0.4;
dmp.Patch_DeleteThreshold = 0.5;

/**
 * Languages the client can highlight. Anything else falls back to plain text
 * rather than being passed through to the highlighter.
 */
export const NOTE_LANGUAGES = [
  'bash',
  'css',
  'diff',
  'dockerfile',
  'go',
  'html',
  'ini',
  'java',
  'javascript',
  'json',
  'markdown',
  'plaintext',
  'powershell',
  'python',
  'rust',
  'sql',
  'typescript',
  'xml',
  'yaml',
];

const purgeOptions = { onPurge: (note) => deleteVersions(note.code) };

export function noteKey(code) {
  return recordKeys.note(normalizeCode(code));
}

function normalizeFormat(input) {
  const value = String(input ?? 'markdown').trim().toLowerCase();
  if (!NOTE_FORMATS.includes(value)) throw badRequest('Unsupported note format');
  return value;
}

function normalizeLanguage(input, format) {
  if (format !== 'code') return null;
  const value = String(input ?? 'plaintext').trim().toLowerCase();
  return NOTE_LANGUAGES.includes(value) ? value : 'plaintext';
}

function normalizeContent(input) {
  const value = String(input ?? '');
  if (!value.trim()) throw badRequest('Note content is required');
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > MAX_NOTE_BYTES) {
    throw payloadTooLarge(`Notes are limited to ${Math.floor(MAX_NOTE_BYTES / 1024)} KB`);
  }
  return value;
}

export function presentNote(note, { includeContent = true } = {}) {
  const base = {
    id: note.id,
    code: note.code,
    title: note.title ?? '',
    format: note.format,
    language: note.language ?? null,
    size: Number(note.size ?? 0),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    expiresAt: note.expiresAt,
    isPersistent: Boolean(note.isPersistent),
    views: Number(note.views ?? 0),
    isCollaborative: Boolean(note.isCollaborative),
    rev: Number(note.rev ?? 0),
    hasPin: Boolean(note.pinHash),
    activity: presentActivity(note),
  };
  return includeContent ? { ...base, content: note.content ?? '' } : base;
}

export async function getNote(code) {
  return loadRecord(noteKey(code), purgeOptions);
}

export async function createNote({ title, content, format, language, isPersistent, isCollaborative }) {
  const store = getStore();
  const normalizedFormat = normalizeFormat(format);
  const normalizedContent = normalizeContent(content);
  const createdAt = now();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateCode();
    const key = recordKeys.note(code);
    if (await store.getRecord(key)) continue;

    const note = {
      id: makeId('note'),
      kind: 'note',
      code,
      title: String(title ?? '').trim().slice(0, MAX_TITLE_LENGTH) || 'Untitled note',
      format: normalizedFormat,
      language: normalizeLanguage(language, normalizedFormat),
      content: normalizedContent,
      size: Buffer.byteLength(normalizedContent, 'utf8'),
      createdAt: toIso(createdAt),
      updatedAt: toIso(createdAt),
      expiresAt: toIso(createdAt + WORKSPACE_LIFETIME_MS),
      isPersistent: isPersistent === true,
      views: 0,
      isCollaborative: isCollaborative === true,
      rev: 0,
    };

    const logged = withActivity(note, 'created');
    await store.putRecord(key, logged);
    return logged;
  }

  throw conflict('Could not allocate a note code, please try again');
}

export async function updateNote(code, { title, content, format, language, isCollaborative }) {
  return mutateRecord(
    noteKey(code),
    async (current) => {
      const changes = { updatedAt: toIso(now()) };

      if (title !== undefined) {
        changes.title = String(title ?? '').trim().slice(0, MAX_TITLE_LENGTH) || 'Untitled note';
      }
      if (format !== undefined) changes.format = normalizeFormat(format);
      if (content !== undefined) {
        changes.content = normalizeContent(content);
        changes.size = Buffer.byteLength(changes.content, 'utf8');
        // Live editors notice a full replacement through the revision number.
        changes.rev = Number(current.rev ?? 0) + 1;
        await addVersion(current.code, { content: current.content, title: current.title, reason: 'before replace' });
      }
      if (isCollaborative !== undefined) changes.isCollaborative = isCollaborative === true;

      const nextFormat = changes.format ?? current.format;
      if (language !== undefined || changes.format) {
        changes.language = normalizeLanguage(language ?? current.language, nextFormat);
      }

      let next = { ...current, ...changes };
      if (changes.content !== undefined) next = withActivity(next, 'edited', '', { coalesce: true });
      if (isCollaborative !== undefined && isCollaborative !== Boolean(current.isCollaborative)) {
        next = withActivity(next, isCollaborative ? 'live-on' : 'live-off');
      }
      if (title !== undefined || format !== undefined) next = withActivity(next, 'details', '', { coalesce: true });
      return next;
    },
    { message: NOT_FOUND_MESSAGE, ...purgeOptions },
  );
}

export async function extendNote(code) {
  return mutateRecord(
    noteKey(code),
    (current) => withActivity({
      ...current,
      expiresAt: extendFrom(current, WORKSPACE_LIFETIME_MS),
      updatedAt: toIso(now()),
    }, 'extended'),
    { message: NOT_FOUND_MESSAGE, ...purgeOptions },
  );
}

export async function setNotePersistence(code, isPersistent) {
  return mutateRecord(
    noteKey(code),
    (current) => withActivity({
      ...current,
      isPersistent,
      expiresAt: isPersistent ? current.expiresAt : toIso(now() + WORKSPACE_LIFETIME_MS),
      updatedAt: toIso(now()),
    }, isPersistent ? 'kept' : 'unkept'),
    { message: NOT_FOUND_MESSAGE, ...purgeOptions },
  );
}

export async function deleteNote(code) {
  const store = getStore();
  const key = noteKey(code);
  if (!(await store.getRecord(key))) return false;
  await store.deleteRecord(key);
  await deleteVersions(code);
  return true;
}

function normalizeClientId(value) {
  const id = String(value ?? '');
  if (!CLIENT_ID_PATTERN.test(id)) throw badRequest('A valid client id is required');
  return id;
}

function applyPatchText(patchText, content) {
  let patches;
  try {
    patches = dmp.patch_fromText(patchText);
  } catch {
    throw badRequest('That edit could not be read');
  }
  const [merged, results] = dmp.patch_apply(patches, content);
  return { merged, rejected: results.filter((ok) => !ok).length };
}

/**
 * One round trip of live editing. The client sends the diff between the last
 * text it got from the server and what it has now; the server merges that into
 * the current text and returns the result. Editing in different places merges
 * cleanly; a hunk whose surroundings were rewritten is dropped and reported in
 * `rejected` rather than corrupting the document.
 *
 * With no patch this is a poll: it returns the text only if the client's
 * revision is behind. `viewer` polls do not count as an editor being present.
 */
export async function syncNote(code, { clientId, opId, rev, patch, viewer = false }) {
  const id = viewer ? null : normalizeClientId(clientId);
  const op = String(opId ?? '').slice(0, 64);
  const patchText = typeof patch === 'string' ? patch : '';
  const clientRev = Number.isInteger(rev) ? rev : -1;
  const nowMs = now();

  let rejected = 0;
  let editors = 0;

  const note = await mutateRecord(
    noteKey(code),
    async (current) => {
      if (!current.isCollaborative) throw conflict('Live editing is turned off for this note');

      let next = current;
      let dirty = false;

      const seen = op && (current.recentOps ?? []).includes(op);
      if (patchText && !seen) {
        const { merged, rejected: failed } = applyPatchText(patchText, current.content ?? '');
        rejected = failed;
        if (merged !== (current.content ?? '')) {
          const bytes = Buffer.byteLength(merged, 'utf8');
          if (bytes > MAX_NOTE_BYTES) {
            throw payloadTooLarge(`Notes are limited to ${Math.floor(MAX_NOTE_BYTES / 1024)} KB`);
          }
          // Save the text as it was before this edit, at most every couple of
          // minutes, or at once if the edit deletes a lot.
          const previousSize = Number(current.size ?? 0);
          const shrink = previousSize - bytes;
          const bigDeletion = shrink > Math.max(LARGE_DELETION_BYTES, previousSize * LARGE_DELETION_RATIO);
          const due = nowMs - Number(current.lastSnapshotAt ?? 0) > SNAPSHOT_INTERVAL_MS;
          let lastSnapshotAt = current.lastSnapshotAt;
          if (due || bigDeletion) {
            await addVersion(current.code, {
              content: current.content,
              title: current.title,
              reason: bigDeletion ? 'before large deletion' : 'auto',
            });
            lastSnapshotAt = nowMs;
          }
          next = withActivity({
            ...next,
            content: merged,
            size: bytes,
            rev: Number(current.rev ?? 0) + 1,
            updatedAt: toIso(nowMs),
            lastSnapshotAt,
          }, 'edited', '', { coalesce: true });
          dirty = true;
        }
        if (op) {
          next = { ...next, recentOps: [...(current.recentOps ?? []), op].slice(-MAX_RECENT_OPS) };
          dirty = true;
        }
      }

      const presence = {};
      for (const [key, seenAt] of Object.entries(current.presence ?? {})) {
        if (nowMs - seenAt <= PRESENCE_WINDOW_MS) presence[key] = seenAt;
      }
      if (id && (!presence[id] || nowMs - presence[id] > PRESENCE_REFRESH_MS)) {
        presence[id] = nowMs;
        // Cap the map so a misbehaving client cannot grow the record.
        const newest = Object.entries(presence).sort((a, b) => b[1] - a[1]).slice(0, MAX_PRESENCE_ENTRIES);
        next = { ...next, presence: Object.fromEntries(newest) };
        dirty = true;
      }
      editors = Object.keys(presence).length;

      return dirty ? next : null;
    },
    { message: NOT_FOUND_MESSAGE, ...purgeOptions },
  );

  const behind = clientRev !== Number(note.rev ?? 0);
  // Always answer a patch with the text, even if nothing changed: a patch that
  // was fully rejected leaves the revision alone, and the client must still
  // learn that its edit did not land instead of resending it forever.
  const sendContent = behind || Boolean(patchText);
  return {
    rev: Number(note.rev ?? 0),
    unchanged: !behind,
    content: sendContent ? note.content ?? '' : undefined,
    rejected,
    editors,
    title: note.title ?? '',
    format: note.format,
    language: note.language ?? null,
    size: Number(note.size ?? 0),
    updatedAt: note.updatedAt,
  };
}

/** Puts an earlier version back. The text it replaces is saved first, so a restore is undoable too. */
export async function restoreNoteVersion(code, versionId) {
  const version = await getVersion(code, versionId);
  if (!version) throw notFound('That version is no longer available');

  return mutateRecord(
    noteKey(code),
    async (current) => {
      await addVersion(current.code, { content: current.content, title: current.title, reason: 'before restore' });
      return withActivity({
        ...current,
        content: version.content,
        size: Buffer.byteLength(version.content, 'utf8'),
        rev: Number(current.rev ?? 0) + 1,
        updatedAt: toIso(now()),
        lastSnapshotAt: now(),
      }, 'restored', 'an earlier version');
    },
    { message: NOT_FOUND_MESSAGE, ...purgeOptions },
  );
}

/** Record-level update for the shared PIN routes. */
export function mutateNoteRecord(code, mutator) {
  return mutateRecord(noteKey(code), mutator, { message: NOT_FOUND_MESSAGE, ...purgeOptions });
}

/** Counts a read without letting the counter write fail the request. */
export function recordNoteView(code) {
  mutateRecord(
    noteKey(code),
    (current) => ({ ...current, views: Number(current.views ?? 0) + 1 }),
    { message: NOT_FOUND_MESSAGE },
  ).catch(() => undefined);
}

export async function cleanupExpiredNotes() {
  const live = await listLiveRecords(recordPrefixes.note, {
    ...purgeOptions,
    keyOf: (note) => recordKeys.note(normalizeCode(note.code)),
  });
  return live.length;
}
