import { MAX_NOTE_BYTES, WORKSPACE_LIFETIME_MS } from './config.js';
import { badRequest, conflict, payloadTooLarge } from './errors.js';
import { generateCode, makeId, normalizeCode } from './ids.js';
import { listLiveRecords, loadRecord, mutateRecord } from './records.js';
import { getStore, recordKeys, recordPrefixes } from './store/index.js';
import { extendFrom, now, toIso } from './time.js';

const NOT_FOUND_MESSAGE = 'Note not found or expired';
const MAX_TITLE_LENGTH = 120;

export const NOTE_FORMATS = ['markdown', 'text', 'code'];

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
  };
  return includeContent ? { ...base, content: note.content ?? '' } : base;
}

export async function getNote(code) {
  return loadRecord(noteKey(code));
}

export async function createNote({ title, content, format, language, isPersistent }) {
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
    };

    await store.putRecord(key, note);
    return note;
  }

  throw conflict('Could not allocate a note code, please try again');
}

export async function updateNote(code, { title, content, format, language }) {
  return mutateRecord(
    noteKey(code),
    (current) => {
      const changes = { updatedAt: toIso(now()) };

      if (title !== undefined) {
        changes.title = String(title ?? '').trim().slice(0, MAX_TITLE_LENGTH) || 'Untitled note';
      }
      if (format !== undefined) changes.format = normalizeFormat(format);
      if (content !== undefined) {
        changes.content = normalizeContent(content);
        changes.size = Buffer.byteLength(changes.content, 'utf8');
      }

      const nextFormat = changes.format ?? current.format;
      if (language !== undefined || changes.format) {
        changes.language = normalizeLanguage(language ?? current.language, nextFormat);
      }

      return { ...current, ...changes };
    },
    { message: NOT_FOUND_MESSAGE },
  );
}

export async function extendNote(code) {
  return mutateRecord(
    noteKey(code),
    (current) => ({
      ...current,
      expiresAt: extendFrom(current, WORKSPACE_LIFETIME_MS),
      updatedAt: toIso(now()),
    }),
    { message: NOT_FOUND_MESSAGE },
  );
}

export async function setNotePersistence(code, isPersistent) {
  return mutateRecord(
    noteKey(code),
    (current) => ({
      ...current,
      isPersistent,
      expiresAt: isPersistent ? current.expiresAt : toIso(now() + WORKSPACE_LIFETIME_MS),
      updatedAt: toIso(now()),
    }),
    { message: NOT_FOUND_MESSAGE },
  );
}

export async function deleteNote(code) {
  const store = getStore();
  const key = noteKey(code);
  if (!(await store.getRecord(key))) return false;
  await store.deleteRecord(key);
  return true;
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
    keyOf: (note) => recordKeys.note(normalizeCode(note.code)),
  });
  return live.length;
}
