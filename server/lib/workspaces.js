import { WORKSPACE_LIFETIME_MS } from './config.js';
import { conflict, notFound } from './errors.js';
import { generateCode, makeId, normalizeCode } from './ids.js';
import { listLiveRecords, loadRecord, mutateRecord, requireRecord } from './records.js';
import { fileKeyFor, getStore, recordKeys, recordPrefixes, workspaceFilePrefix } from './store/index.js';
import { isDescendantPath, rebasePath } from './paths.js';
import { extendFrom, now, toIso } from './time.js';

const NOT_FOUND_MESSAGE = 'Workspace not found or expired';

export function workspaceKey(code) {
  return recordKeys.workspace(normalizeCode(code));
}

/** Drops every stored byte for a workspace; safe to call more than once. */
export async function purgeWorkspaceFiles(workspace) {
  if (!workspace?.id) return;
  await getStore().deleteFilePrefix(workspaceFilePrefix(workspace.id));
}

const purgeOptions = { onPurge: purgeWorkspaceFiles };

function sortItems(items) {
  return [...items].sort((left, right) => {
    if (left.type !== right.type) return left.type === 'folder' ? -1 : 1;
    return String(left.name ?? '').localeCompare(String(right.name ?? ''));
  });
}

/** Shapes a record for the client: sorted items, no internal storage keys. */
export function presentWorkspace(workspace) {
  return {
    id: workspace.id,
    code: workspace.code,
    name: workspace.name,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    expiresAt: workspace.expiresAt,
    isPersistent: Boolean(workspace.isPersistent),
    items: sortItems(workspace.items ?? []).map((item) => ({
      id: item.id,
      type: item.type,
      name: item.name,
      path: item.path,
      parentPath: item.parentPath,
      createdAt: item.createdAt,
      ...(item.type === 'file' ? { size: item.size, mimeType: item.mimeType } : {}),
    })),
  };
}

export async function getWorkspace(code) {
  return loadRecord(workspaceKey(code), purgeOptions);
}

export async function requireWorkspace(code) {
  return requireRecord(workspaceKey(code), NOT_FOUND_MESSAGE, purgeOptions);
}

export async function updateWorkspace(code, mutator) {
  return mutateRecord(workspaceKey(code), mutator, { message: NOT_FOUND_MESSAGE, ...purgeOptions });
}

export async function createWorkspace({ name, isPersistent }) {
  const store = getStore();
  const createdAt = now();

  // Retry on the vanishingly unlikely chance a generated code is already taken.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateCode();
    const key = recordKeys.workspace(code);
    if (await store.getRecord(key)) continue;

    const workspace = {
      id: makeId('ws'),
      kind: 'workspace',
      code,
      name: String(name ?? '').trim() || 'Untitled workspace',
      createdAt: toIso(createdAt),
      updatedAt: toIso(createdAt),
      expiresAt: toIso(createdAt + WORKSPACE_LIFETIME_MS),
      isPersistent: isPersistent === true,
      items: [],
    };

    await store.putRecord(key, workspace);
    return workspace;
  }

  throw conflict('Could not allocate a workspace code, please try again');
}

export async function deleteWorkspace(code) {
  const store = getStore();
  const key = workspaceKey(code);
  const workspace = await store.getRecord(key);
  if (!workspace) return false;
  await purgeWorkspaceFiles(workspace);
  await store.deleteRecord(key);
  return true;
}

export function touch(workspace, changes) {
  return { ...workspace, ...changes, updatedAt: toIso(now()) };
}

export function extendWorkspace(workspace) {
  return touch(workspace, { expiresAt: extendFrom(workspace, WORKSPACE_LIFETIME_MS) });
}

export function setPersistence(workspace, isPersistent) {
  return touch(workspace, {
    isPersistent,
    // Leaving permanent mode restarts the clock rather than reviving a past deadline.
    expiresAt: isPersistent ? workspace.expiresAt : toIso(now() + WORKSPACE_LIFETIME_MS),
  });
}

export function findItem(workspace, itemPath) {
  return (workspace.items ?? []).find((item) => item.path === itemPath) ?? null;
}

export function requireItem(workspace, itemPath) {
  const item = findItem(workspace, itemPath);
  if (!item) throw notFound('Item not found');
  return item;
}

export function hasItemAt(workspace, itemPath) {
  return (workspace.items ?? []).some((item) => item.path === itemPath);
}

/** An item plus everything stored beneath it, for recursive delete. */
export function collectSubtree(workspace, itemPath) {
  return (workspace.items ?? []).filter(
    (item) => item.path === itemPath || isDescendantPath(item.path, itemPath),
  );
}

export function removeSubtree(workspace, itemPath) {
  const remaining = (workspace.items ?? []).filter(
    (item) => item.path !== itemPath && !isDescendantPath(item.path, itemPath),
  );
  return touch(workspace, { items: remaining });
}

/** Renames an item and re-roots every descendant's path and parentPath. */
export function renameSubtree(workspace, fromPath, toPath, nextName) {
  const items = (workspace.items ?? []).map((item) => {
    if (item.path !== fromPath && !isDescendantPath(item.path, fromPath)) return item;
    return {
      ...item,
      name: item.path === fromPath ? nextName : item.name,
      path: rebasePath(item.path, fromPath, toPath),
      parentPath: rebasePath(item.parentPath, fromPath, toPath),
    };
  });
  return touch(workspace, { items });
}

export function fileKeyForItem(workspace, item) {
  return fileKeyFor(workspace.id, item.id);
}

/** Used by the scheduled cleanup task and by local server startup. */
export async function cleanupExpiredWorkspaces() {
  const live = await listLiveRecords(recordPrefixes.workspace, {
    onPurge: purgeWorkspaceFiles,
    keyOf: (workspace) => recordKeys.workspace(normalizeCode(workspace.code)),
  });
  return live.length;
}
