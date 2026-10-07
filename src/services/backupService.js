import { rememberLinkSlug, rememberedLinkSlugs, getLink } from './linkService.js';
import { rememberNoteCode, rememberedNoteCodes } from './noteService.js';
import { rememberWorkspaceCode, rememberedWorkspaceCodes } from './workspaceService.js';
import { request } from './apiClient.js';

/**
 * The list of workspaces, notes and links a person has made lives only in this
 * browser (the server has no accounts), so a new laptop or cleared site data
 * loses it. This module turns that list into a small file and back again. Only
 * codes are exported — never content — so the file is as sensitive as the codes
 * themselves, which is to say: keep it private.
 */

export function buildBackup() {
  return {
    app: 'netfileshare',
    version: 1,
    exportedAt: new Date().toISOString(),
    workspaces: rememberedWorkspaceCodes(),
    notes: rememberedNoteCodes(),
    links: rememberedLinkSlugs(),
  };
}

export function countBackup(backup) {
  return backup.workspaces.length + backup.notes.length + backup.links.length;
}

const CODE_PATTERN = /^[A-Za-z1-9]{6}$/;

/** Accepts the exported JSON, or any pasted text containing codes and slugs. */
export function parseBackup(text) {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('Nothing to restore. Paste your codes or choose a backup file.');

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const list = (value) => (Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : []);
      return {
        workspaces: list(parsed.workspaces).map((code) => code.toUpperCase()),
        notes: list(parsed.notes).map((code) => code.toUpperCase()),
        links: list(parsed.links),
        loose: [],
      };
    }
  } catch {
    // Not JSON: treat it as a loose list of codes below.
  }

  // Six-character codes are shared by workspaces and notes, so a loose list has
  // to be checked against both. Anything else is taken to be a short-link slug.
  const tokens = raw.split(/[\s,;]+/).map((token) => token.trim()).filter(Boolean);
  return {
    workspaces: [],
    notes: [],
    links: tokens.filter((token) => !CODE_PATTERN.test(token)),
    loose: tokens.filter((token) => CODE_PATTERN.test(token)).map((token) => token.toUpperCase()),
  };
}

/** Looks a code up without prompting. Returns 'found', 'locked' or 'missing'. */
async function probe(url) {
  try {
    await request(url, { interactive: false });
    return 'found';
  } catch (error) {
    return error?.code === 'pin_required' ? 'locked' : 'missing';
  }
}

/**
 * Re-adds every code the server still knows about. Expired or mistyped codes are
 * skipped and reported rather than being added as dead entries.
 */
export async function restoreBackup(text) {
  const parsed = parseBackup(text);
  const result = { workspaces: 0, notes: 0, links: 0, skipped: [] };
  const seen = new Set();
  const once = (kind, value) => {
    const key = `${kind}:${value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  await Promise.all([
    ...parsed.workspaces.map(async (code) => {
      if (!once('w', code)) return;
      if ((await probe(`/api/workspaces/${code}`)) === 'missing') result.skipped.push(code);
      else { rememberWorkspaceCode(code); result.workspaces += 1; }
    }),
    ...parsed.notes.map(async (code) => {
      if (!once('n', code)) return;
      if ((await probe(`/api/notes/${code}`)) === 'missing') result.skipped.push(code);
      else { rememberNoteCode(code); result.notes += 1; }
    }),
    ...parsed.loose.map(async (code) => {
      if (!once('l', code)) return;
      if ((await probe(`/api/workspaces/${code}`)) !== 'missing') {
        rememberWorkspaceCode(code);
        result.workspaces += 1;
      } else if ((await probe(`/api/notes/${code}`)) !== 'missing') {
        rememberNoteCode(code);
        result.notes += 1;
      } else {
        result.skipped.push(code);
      }
    }),
    ...parsed.links.map(async (slug) => {
      if (!once('s', slug)) return;
      if (await getLink(slug)) { rememberLinkSlug(slug); result.links += 1; }
      else result.skipped.push(slug);
    }),
  ]);

  return result;
}
