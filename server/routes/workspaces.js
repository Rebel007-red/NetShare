import express from 'express';
import multer from 'multer';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from '../lib/config.js';
import { badRequest, conflict, notFound, payloadTooLarge } from '../lib/errors.js';
import { makeId } from '../lib/ids.js';
import { buildChildPath, normalizePath, parentPathOf, sanitizeName, sanitizeUploadName } from '../lib/paths.js';
import { getStore } from '../lib/store/index.js';
import { now, toIso } from '../lib/time.js';
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
    const workspace = await updateWorkspace(req.params.code, (current) => touch(current, { name: nextName }));
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
      });
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

      return touch(current, { items });
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
      return renameSubtree(current, item.path, nextPath, nextName);
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
      requireItem(current, itemPath);
      const doomed = collectSubtree(current, itemPath).filter((item) => item.type === 'file');
      await Promise.all(
        doomed.map((item) => store.deleteFile(fileKeyForItem(current, item)).catch(() => undefined)),
      );
      return removeSubtree(current, itemPath);
    });

    res.json(presentWorkspace(workspace));
  } catch (error) {
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
