import { STORE_DRIVER } from '../config.js';
import { createBlobStore } from './blobs.js';
import { createDiskStore } from './disk.js';

let instance = null;

/**
 * One storage interface, two drivers:
 *  - `disk`  for local dev, `npm run start:prod` and Docker
 *  - `blobs` for Netlify, whose function filesystem does not persist
 */
export function getStore() {
  if (instance) return instance;
  instance = STORE_DRIVER === 'blobs' ? createBlobStore() : createDiskStore();
  return instance;
}

export const recordKeys = {
  workspace: (code) => `workspaces/${code}`,
  link: (slug) => `links/${slug}`,
  note: (code) => `notes/${code}`,
};

export const recordPrefixes = {
  workspace: 'workspaces',
  link: 'links',
  note: 'notes',
};

/** File bytes are keyed by opaque ids, so no client string reaches a path. */
export function fileKeyFor(workspaceId, itemId) {
  return `files/${workspaceId}/${itemId}`;
}

export function workspaceFilePrefix(workspaceId) {
  return `files/${workspaceId}`;
}
