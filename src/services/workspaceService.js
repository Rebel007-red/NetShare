import { request } from './apiClient.js';
import { createRecentStore, readSingle, writeSingle } from './recentStore.js';

const LAST_CODE_KEY = 'netfileshare-last-workspace-code';
const RECENT_CODES_KEY = 'netfileshare-recent-codes';

export { formatBytes, formatDateTime, getRemainingLabel } from './apiClient.js';

function normalizeCode(code) {
  return String(code ?? '').trim().toUpperCase();
}

const recent = createRecentStore(RECENT_CODES_KEY, { normalize: normalizeCode });

/** Mirrors the server's path rules so the UI never sends something it rejects. */
function ensureRoot(input) {
  const raw = String(input ?? '').trim().replace(/\\/g, '/');
  const segments = raw.split('/').filter((segment) => segment && segment !== '.' && segment !== '..');
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

function encodePath(value) {
  return encodeURIComponent(ensureRoot(value));
}

function workspaceUrl(code, suffix = '') {
  return `/api/workspaces/${encodeURIComponent(normalizeCode(code))}${suffix}`;
}

function remember(workspace) {
  if (workspace?.code) {
    recent.remember(workspace.code);
    writeSingle(LAST_CODE_KEY, normalizeCode(workspace.code));
  }
  return workspace;
}

export function getLastWorkspaceCode() {
  return normalizeCode(readSingle(LAST_CODE_KEY));
}

export function clearLastWorkspaceCode() {
  writeSingle(LAST_CODE_KEY, '');
}

export function leaveWorkspace() {
  clearLastWorkspaceCode();
}

/**
 * Resolves every remembered code, drops the ones the server has forgotten and
 * prunes the stored list so expired codes stop being re-requested forever.
 */
export async function listWorkspaces() {
  const codes = recent.list();
  if (codes.length === 0) return [];

  const resolved = await Promise.all(codes.map((code) => getWorkspaceByCode(code)));
  const workspaces = resolved.filter(Boolean);
  recent.replace(workspaces.map((workspace) => workspace.code));

  if (!workspaces.some((workspace) => workspace.code === getLastWorkspaceCode())) {
    clearLastWorkspaceCode();
  }
  return workspaces;
}

export async function getWorkspaceByCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  try {
    return await request(workspaceUrl(normalized));
  } catch {
    return null;
  }
}

export async function createWorkspace({ name = '', isPersistent = false } = {}) {
  return remember(await request('/api/workspaces', { method: 'POST', json: { name, isPersistent } }));
}

export async function joinWorkspace(code) {
  const normalized = normalizeCode(code);
  if (normalized.length !== 6) throw new Error('Workspace codes are 6 characters long');
  return remember(await request(workspaceUrl(normalized)));
}

export async function extendWorkspace(code) {
  return remember(await request(workspaceUrl(code, '/extend'), { method: 'POST' }));
}

export async function toggleWorkspacePersistence(code, isPersistent) {
  return remember(await request(workspaceUrl(code, '/persistence'), {
    method: 'POST',
    json: { isPersistent: Boolean(isPersistent) },
  }));
}

export async function deleteWorkspace(code) {
  await request(workspaceUrl(code), { method: 'DELETE' });
  recent.forget(code);
  if (getLastWorkspaceCode() === normalizeCode(code)) clearLastWorkspaceCode();
}

export async function renameWorkspace(code, name) {
  return remember(await request(workspaceUrl(code), { method: 'PATCH', json: { name } }));
}

export async function createFolder(code, parentPath, name) {
  return remember(await request(workspaceUrl(code, '/folders'), {
    method: 'POST',
    json: { parentPath: ensureRoot(parentPath), name },
  }));
}

export async function uploadFiles(code, parentPath, files) {
  const list = Array.from(files ?? []);
  if (list.length === 0) throw new Error('Select at least one file to upload');

  const formData = new FormData();
  formData.set('parentPath', ensureRoot(parentPath));
  list.forEach((file) => formData.append('files', file, file.name));

  return remember(await request(workspaceUrl(code, '/files'), { method: 'POST', body: formData }));
}

export async function removeItem(code, itemPath) {
  return remember(await request(workspaceUrl(code, `/items?path=${encodePath(itemPath)}`), { method: 'DELETE' }));
}

export async function renameItem(code, itemPath, name) {
  return remember(await request(workspaceUrl(code, '/items/rename'), {
    method: 'PATCH',
    json: { path: ensureRoot(itemPath), name },
  }));
}

export function getDownloadUrl(code, item) {
  return workspaceUrl(code, `/download?path=${encodePath(item?.path)}`);
}

export function getInlineFileUrl(code, item) {
  return workspaceUrl(code, `/file?path=${encodePath(item?.path)}`);
}

export function downloadItem(code, item) {
  if (!code || !item?.path) return;
  // An anchor click keeps the Content-Disposition filename, unlike window.open.
  const anchor = document.createElement('a');
  anchor.href = getDownloadUrl(code, item);
  anchor.rel = 'noopener';
  anchor.download = item.name ?? '';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function getChildren(workspace, parentPath = '/') {
  const parent = ensureRoot(parentPath);
  return (workspace?.items ?? [])
    .filter((item) => ensureRoot(item.parentPath ?? '/') === parent)
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === 'folder' ? -1 : 1;
      return String(left.name ?? '').localeCompare(String(right.name ?? ''));
    });
}

export function getWorkspaceStats(workspace) {
  const items = Array.isArray(workspace?.items) ? workspace.items : [];
  const files = items.filter((item) => item.type === 'file');
  return {
    files: files.length,
    folders: items.filter((item) => item.type === 'folder').length,
    totalBytes: files.reduce((sum, file) => sum + Number(file.size ?? 0), 0),
  };
}

export function buildBreadcrumbs(path) {
  const normalized = ensureRoot(path);
  if (normalized === '/') return [{ label: 'Root', path: '/' }];
  const parts = normalized.split('/').filter(Boolean);
  return [
    { label: 'Root', path: '/' },
    ...parts.map((part, index) => ({ label: part, path: `/${parts.slice(0, index + 1).join('/')}` })),
  ];
}

/** Deepest still-existing ancestor of `path`, used after a folder is deleted. */
export function resolveExistingPath(workspace, path) {
  const normalized = ensureRoot(path);
  if (normalized === '/') return '/';
  const parts = normalized.split('/').filter(Boolean);

  for (let depth = parts.length; depth > 0; depth -= 1) {
    const candidate = `/${parts.slice(0, depth).join('/')}`;
    if ((workspace?.items ?? []).some((item) => item.path === candidate && item.type === 'folder')) {
      return candidate;
    }
  }
  return '/';
}
