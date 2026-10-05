import { request } from './apiClient.js';
import { createRecentStore } from './recentStore.js';

const RECENT_NOTES_KEY = 'netfileshare-recent-notes';

export { formatBytes, formatDateTime, getRemainingLabel } from './apiClient.js';

export const NOTE_FORMATS = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: 'Plain text' },
  { value: 'code', label: 'Code' },
];

/** Must stay in sync with NOTE_LANGUAGES in server/lib/notes.js. */
export const NOTE_LANGUAGES = [
  'plaintext',
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
  'powershell',
  'python',
  'rust',
  'sql',
  'typescript',
  'xml',
  'yaml',
];

function normalizeCode(code) {
  return String(code ?? '').trim().toUpperCase();
}

const recent = createRecentStore(RECENT_NOTES_KEY, { normalize: normalizeCode });

function noteUrl(code, suffix = '') {
  return `/api/notes/${encodeURIComponent(normalizeCode(code))}${suffix}`;
}

function remember(note) {
  if (note?.code) recent.remember(note.code);
  return note;
}

export function getNoteShareUrl(note) {
  const code = normalizeCode(note?.code ?? note);
  if (!code) return '';
  return new URL(`/note/${code}`, window.location.origin).toString();
}

export function getRawUrl(code) {
  return noteUrl(code, '/raw');
}

export function getDownloadUrl(code) {
  return noteUrl(code, '/raw?download=1');
}

export async function listNotes() {
  const codes = recent.list();
  if (codes.length === 0) return [];

  const resolved = await Promise.all(codes.map((code) => getNote(code)));
  const notes = resolved.filter(Boolean);
  recent.replace(notes.map((note) => note.code));
  return notes;
}

export async function getNote(code, { countView = false } = {}) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  try {
    return await request(noteUrl(normalized, countView ? '?countView=1' : ''));
  } catch {
    return null;
  }
}

/** Throws instead of returning null, so the share view can explain the failure. */
export async function fetchNoteOrThrow(code) {
  const normalized = normalizeCode(code);
  if (normalized.length !== 6) throw new Error('Note codes are 6 characters long');
  return request(noteUrl(normalized, '?countView=1'));
}

export async function createNote({ title, content, format = 'markdown', language = null, isPersistent = false }) {
  return remember(await request('/api/notes', {
    method: 'POST',
    json: { title, content, format, language, isPersistent },
  }));
}

export async function updateNote(code, changes) {
  return remember(await request(noteUrl(code), { method: 'PATCH', json: changes }));
}

export async function extendNote(code) {
  return remember(await request(noteUrl(code, '/extend'), { method: 'POST' }));
}

export async function toggleNotePersistence(code, isPersistent) {
  return remember(await request(noteUrl(code, '/persistence'), {
    method: 'POST',
    json: { isPersistent: Boolean(isPersistent) },
  }));
}

export async function deleteNote(code) {
  await request(noteUrl(code), { method: 'DELETE' });
  recent.forget(code);
}

export function downloadNote(note) {
  if (!note?.code) return;
  const anchor = document.createElement('a');
  anchor.href = getDownloadUrl(note.code);
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
