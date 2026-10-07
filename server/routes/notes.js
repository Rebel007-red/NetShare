import express from 'express';
import { badRequest, notFound } from '../lib/errors.js';
import { isValidCode, normalizeCode } from '../lib/ids.js';
import { getVersion, listVersions } from '../lib/noteVersions.js';
import {
  createNote,
  deleteNote,
  extendNote,
  getNote,
  presentNote,
  recordNoteView,
  restoreNoteVersion,
  setNotePersistence,
  syncNote,
  updateNote,
} from '../lib/notes.js';

const router = express.Router();

function requireCodeParam(value) {
  const code = normalizeCode(value);
  if (!isValidCode(code)) throw badRequest('That note code is not valid');
  return code;
}

async function loadNoteOr404(value) {
  const note = await getNote(requireCodeParam(value));
  if (!note) throw notFound('Note not found or expired');
  return note;
}

const EXTENSION_BY_FORMAT = {
  markdown: 'md',
  text: 'txt',
  code: 'txt',
};

const EXTENSION_BY_LANGUAGE = {
  bash: 'sh',
  css: 'css',
  diff: 'diff',
  dockerfile: 'dockerfile',
  go: 'go',
  html: 'html',
  ini: 'ini',
  java: 'java',
  javascript: 'js',
  json: 'json',
  markdown: 'md',
  powershell: 'ps1',
  python: 'py',
  rust: 'rs',
  sql: 'sql',
  typescript: 'ts',
  xml: 'xml',
  yaml: 'yaml',
};

/** Strips characters that have no business in a Content-Disposition filename. */
function downloadFilename(note) {
  const extension = note.format === 'code'
    ? EXTENSION_BY_LANGUAGE[note.language] ?? 'txt'
    : EXTENSION_BY_FORMAT[note.format] ?? 'txt';
  const base = String(note.title || 'note')
    .replace(/[^\w .-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-. ]+|[-. ]+$/g, '')
    .slice(0, 60) || 'note';
  return `${base}.${extension}`;
}

router.post('/', async (req, res, next) => {
  try {
    const note = await createNote({
      title: req.body?.title,
      content: req.body?.content,
      format: req.body?.format,
      language: req.body?.language,
      isPersistent: req.body?.isPersistent === true,
      isCollaborative: req.body?.isCollaborative === true,
    });
    res.status(201).json(presentNote(note));
  } catch (error) {
    next(error);
  }
});

router.get('/:code', async (req, res, next) => {
  try {
    const note = await loadNoteOr404(req.params.code);
    // Count reads of the shared view, not the author's own polling.
    if (req.query.countView === '1') recordNoteView(note.code);
    res.json(presentNote(note));
  } catch (error) {
    next(error);
  }
});

router.get('/:code/raw', async (req, res, next) => {
  try {
    const note = await loadNoteOr404(req.params.code);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.query.download === '1') {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(downloadFilename(note))}`,
      );
    }
    res.send(note.content ?? '');
  } catch (error) {
    next(error);
  }
});

router.patch('/:code', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const note = await updateNote(requireCodeParam(req.params.code), {
      title: body.title,
      content: body.content,
      format: body.format,
      language: Object.hasOwn(body, 'language') ? body.language : undefined,
      isCollaborative: Object.hasOwn(body, 'isCollaborative') ? body.isCollaborative : undefined,
    });
    res.json(presentNote(note));
  } catch (error) {
    next(error);
  }
});

router.post('/:code/sync', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const result = await syncNote(requireCodeParam(req.params.code), {
      clientId: body.clientId,
      opId: body.opId,
      rev: body.rev,
      patch: body.patch,
      viewer: body.viewer === true,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/:code/versions', async (req, res, next) => {
  try {
    const note = await loadNoteOr404(req.params.code);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ versions: await listVersions(note.code) });
  } catch (error) {
    next(error);
  }
});

router.get('/:code/versions/:id', async (req, res, next) => {
  try {
    const note = await loadNoteOr404(req.params.code);
    const version = await getVersion(note.code, req.params.id);
    if (!version) throw notFound('That version is no longer available');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ id: version.id, at: version.at, size: version.size, title: version.title, reason: version.reason, content: version.content });
  } catch (error) {
    next(error);
  }
});

router.post('/:code/versions/:id/restore', async (req, res, next) => {
  try {
    const note = await restoreNoteVersion(requireCodeParam(req.params.code), req.params.id);
    res.json(presentNote(note));
  } catch (error) {
    next(error);
  }
});

router.post('/:code/extend', async (req, res, next) => {
  try {
    const note = await extendNote(requireCodeParam(req.params.code));
    res.json(presentNote(note));
  } catch (error) {
    next(error);
  }
});

router.post('/:code/persistence', async (req, res, next) => {
  try {
    const note = await setNotePersistence(requireCodeParam(req.params.code), req.body?.isPersistent === true);
    res.json(presentNote(note));
  } catch (error) {
    next(error);
  }
});

router.delete('/:code', async (req, res, next) => {
  try {
    await deleteNote(requireCodeParam(req.params.code));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
