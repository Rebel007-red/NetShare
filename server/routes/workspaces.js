import express from 'express';
import multer from 'multer';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES, MAX_ZIP_BYTES } from '../lib/config.js';
import { badRequest, conflict, notFound, payloadTooLarge } from '../lib/errors.js';
import { makeId } from '../lib/ids.js';
import { buildChildPath, isDescendantPath, normalizePath, parentPathOf, sanitizeName, sanitizeUploadName } from '../lib/paths.js';
import { getStore } from '../lib/store/index.js';
import { now, toIso } from '../lib/time.js';
import { withActivity } from '../lib/activity.js';
import { streamZip } from '../lib/zip.js';
import {
  collectSubtree,
  createWorkspace,
  deleteWorkspace,
  extendWorkspace,
  fileKeyForItem,
  hasItemAt,
  presentWorkspace,
  removeSubtree,
  renameSubtree,
  requireItem,
  requireWorkspace,
  setPersistence,
  touch,
  updateWorkspace,
} from '../lib/workspaces.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_UPLOAD_FILES },
  // Browsers send filenames as UTF-8. The default (latin1) turns "ünï.txt" into
  // "Ã¼nÃ¯.txt" for every non-ASCII name.
  defParamCharset: 'utf8',
});

/**
 * Turns multer's limit errors into the same JSON shape as the rest of the API.
 * Without this an oversized upload surfaces as an unhandled 500.
 */
function uploadFiles(req, res, next) {
  upload.array('files')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      next(payloadTooLarge(`Each file must be ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB or smaller`));
      return;
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      next(badRequest(`Upload at most ${MAX_UPLOAD_FILES} files at a time`));
      return;
    }
    next(error);
  });
}

async function sendStoredFile(res, workspace, item, { asDownload }) {
  const store = getStore();
  const key = fileKeyForItem(workspace, item);

  res.setHeader('Content-Type', item.mimeType || 'application/octet-stream');
  // Content-Length is deliberately left to the framework: trusting the stored
  // metadata would truncate or hang the response if the two ever disagreed.
  // Share codes are secrets, so keep stored content out of shared caches.
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (asDownload) {
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`);
  } else {
    // Inline previews of untrusted content get a locked-down sandbox.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  }

  const stream = await store.getFileStream(key);
  if (!stream) throw notFound('Stored file is no longer available');

  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/** "a.txt", "a.txt, b.txt", or "a.txt, b.txt and 3 more" — enough to recognise an upload. */
function summarizeNames(names) {
  const shown = names.slice(0, 2).join(', ');
  return names.length > 2 ? `${shown} and ${names.length - 2} more` : shown;
}

function zipFilename(workspace, folder) {
  const base = [workspace.name, folder?.name].filter(Boolean).join('-');
  const clean = base.replace(/[^\w .-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-. ]+|[-. ]+$/g, '').slice(0, 80);
  return `${clean || workspace.code}.zip`;
}

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const workspace = await createWorkspace({
      name: req.body?.name,
      isPersistent: req.body?.isPersistent === true,
    });
    res.status(201).json(presentWorkspace(workspace));
  } catch (error) {
    next(error);
  }
});

router.get('/:code', async (req, res, next) => {
  try {
    const workspace = await requireWorkspace(req.params.code);
    res.json(presentWorkspace(workspace));
  } catch (error) {
    next(error);
  }
});

router.patch('/:code', async (req, res, next) => {
  try {
    const nextName = sanitizeName(req.body?.name);
    const workspace = await updateWorkspace(req.params.code, (current) => touch(current, { name: nextName }, ['renamed-workspace', nextName]));
    res.json(presentWorkspace(workspace));
  } catch (error) {
    next(error);
  }
});

router.delete('/:code', async (req, res, next) => {
  try {
    await deleteWorkspace(req.params.code);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post('/:code/extend', async (req, res, next) => {
  try {
    const workspace = await updateWorkspace(req.params.code, (current) => extendWorkspace(current));
    res.json(presentWorkspace(workspace));
  } catch (error) {
    next(error);
  }
});

router.post('/:code/persistence', async (req, res, next) => {
  try {
    const nextValue = req.body?.isPersistent === true;
    const workspace = await updateWorkspace(req.params.code, (current) => setPersistence(current, nextValue));
    res.json(presentWorkspace(workspace));
  } catch (error) {
    next(error);
  }
});

router.post('/:code/folders', async (req, res, next) => {
  try {
    const parentPath = normalizePath(req.body?.parentPath ?? '/');
    const folderName = sanitizeName(req.body?.name);

    const workspace = await updateWorkspace(req.params.code, (current) => {
      if (parentPath !== '/' && !hasItemAt(current, parentPath)) {
        throw notFound('The destination folder no longer exists');
      }
      const nextPath = buildChildPath(parentPath, folderName);
      if (hasItemAt(current, nextPath)) throw conflict('An item with the same name already exists here');

      return touch(current, {
        items: [
          {
            id: makeId('folder'),
            type: 'folder',
            name: folderName,
            path: nextPath,
            parentPath,
            createdAt: toIso(now()),
          },
          ...current.items,
        ],
      }, ['folder', folderName]);
    });

    res.status(201).json(presentWorkspace(workspace));
  } catch (error) {
    next(error);
  }
});

router.post('/:code/files', uploadFiles, async (req, res, next) => {
  const store = getStore();
  const writtenKeys = [];

  try {
    const parentPath = normalizePath(req.body?.parentPath ?? '/');
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) throw badRequest('At least one file is required');

    const workspace = await updateWorkspace(req.params.code, async (current) => {
      if (parentPath !== '/' && !hasItemAt(current, parentPath)) {
        throw notFound('The destination folder no longer exists');
      }

      const items = [...current.items];

      for (const file of files) {
        const name = sanitizeUploadName(file.originalname);
        const nextPath = buildChildPath(parentPath, name);
        if (items.some((item) => item.path === nextPath)) {
          throw conflict(`An item named ${name} already exists here`);
        }

        const item = {
          id: makeId('file'),
          type: 'file',
          name,
          size: file.size,
          mimeType: file.mimetype || 'application/octet-stream',
          path: nextPath,
          parentPath,
          createdAt: toIso(now()),
        };

        const key = fileKeyForItem(current, item);
        await store.putFile(key, file.buffer);
        writtenKeys.push(key);
        items.unshift(item);
      }

      return touch(current, { items }, ['uploaded', summarizeNames(files.map((file) => sanitizeUploadName(file.originalname)))]);
    });

    writtenKeys.length = 0;
    res.status(201).json(presentWorkspace(workspace));
  } catch (error) {
    // The metadata write never landed, so drop any bytes already stored.
    await Promise.all(writtenKeys.map((key) => store.deleteFile(key).catch(() => undefined)));
    next(error);
  }
});

router.patch('/:code/items/rename', async (req, res, next) => {
  try {
    const itemPath = normalizePath(req.body?.path ?? '/');
    const nextName = sanitizeName(req.body?.name);
    if (itemPath === '/') throw badRequest('The root folder cannot be renamed');

    const workspace = await updateWorkspace(req.params.code, (current) => {
      const item = requireItem(current, itemPath);
      const nextPath = buildChildPath(parentPathOf(item.path), nextName);
      if (nextPath === item.path) return current;
      if (hasItemAt(current, nextPath)) throw conflict('An item with that name already exists here');
      // File bytes are keyed by item id, so a rename touches metadata only.
      return withActivity(renameSubtree(current, item.path, nextPath, nextName), 'renamed', `${item.name} to ${nextName}`);
    });

    res.json(presentWorkspace(workspace));
  } catch (error) {
    next(error);
  }
});

router.delete('/:code/items', async (req, res, next) => {
  try {
    const itemPath = normalizePath(req.query.path ?? '/');
    if (itemPath === '/') throw badRequest('The root folder cannot be deleted');

    const store = getStore();
    const workspace = await updateWorkspace(req.params.code, async (current) => {
      const target = requireItem(current, itemPath);
      const doomed = collectSubtree(current, itemPath).filter((item) => item.type === 'file');
      await Promise.all(
        doomed.map((item) => store.deleteFile(fileKeyForItem(current, item)).catch(() => undefined)),
      );
      return withActivity(removeSubtree(current, itemPath), 'deleted', target.name);
    });

    res.json(presentWorkspace(workspace));
  } catch (error) {
    next(error);
  }
});

/**
 * A folder (or the whole workspace) as one ZIP. Files are read and written one at
 * a time, so memory stays at the size of the largest file, not the whole folder.
 */
router.get('/:code/zip', async (req, res, next) => {
  try {
    const workspace = await requireWorkspace(req.params.code);
    const folderPath = normalizePath(req.query.path ?? '/');

    let folder = null;
    if (folderPath !== '/') {
      folder = requireItem(workspace, folderPath);
      if (folder.type !== 'folder') throw badRequest('Only folders can be downloaded as a ZIP');
    }

    const inside = (workspace.items ?? []).filter(
      (item) => folderPath === '/' || isDescendantPath(item.path, folderPath),
    );
    if (inside.length === 0) throw badRequest('There is nothing to download here yet');

    const total = inside.reduce((sum, item) => sum + (item.type === 'file' ? Number(item.size ?? 0) : 0), 0);
    if (total > MAX_ZIP_BYTES) {
      const limitMb = Math.floor(MAX_ZIP_BYTES / (1024 * 1024));
      throw payloadTooLarge(`This is too big for one ZIP (the limit is ${limitMb} MB). Download the files one at a time.`);
    }

    const store = getStore();
    const prefixLength = folderPath === '/' ? 1 : folderPath.length + 1;
    const entries = [...inside]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((item) => {
        const isDir = item.type === 'folder';
        const relative = item.path.slice(prefixLength);
        return {
          name: isDir ? `${relative}/` : relative,
          isDir,
          size: isDir ? 0 : Number(item.size ?? 0),
          modifiedAt: item.createdAt,
          read: async () => {
            const bytes = await store.getFileBuffer(fileKeyForItem(workspace, item));
            if (!bytes) throw notFound(`${item.name} is no longer available`);
            return bytes;
          },
        };
      });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipFilename(workspace, folder))}`);

    await streamZip(res, entries);
    res.end();
  } catch (error) {
    // Once bytes are on the wire the status is fixed; drop the connection so the
    // client sees a failed download instead of a ZIP that is quietly truncated.
    if (res.headersSent) {
      res.destroy();
      return;
    }
    next(error);
  }
});

router.get('/:code/download', async (req, res, next) => {
  try {
    const workspace = await requireWorkspace(req.params.code);
    const item = requireItem(workspace, normalizePath(req.query.path ?? '/'));
    if (item.type !== 'file') throw badRequest('Only files can be downloaded');
    await sendStoredFile(res, workspace, item, { asDownload: true });
  } catch (error) {
    next(error);
  }
});

router.get('/:code/file', async (req, res, next) => {
  try {
    const workspace = await requireWorkspace(req.params.code);
    const item = requireItem(workspace, normalizePath(req.query.path ?? '/'));
    if (item.type !== 'file') throw badRequest('Only files can be previewed');
    await sendStoredFile(res, workspace, item, { asDownload: false });
  } catch (error) {
    next(error);
  }
});

export default router;
