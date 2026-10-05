import express from 'express';
import { badRequest, notFound } from '../lib/errors.js';
import { isValidSlug, normalizeSlug } from '../lib/ids.js';
import { createLink, deleteLink, getLink, presentLink, updateLink } from '../lib/links.js';

const router = express.Router();

function requireSlugParam(value) {
  const slug = normalizeSlug(value);
  if (!isValidSlug(slug)) throw badRequest('That short code is not valid');
  return slug;
}

router.post('/', async (req, res, next) => {
  try {
    const link = await createLink({
      targetUrl: req.body?.targetUrl,
      alias: req.body?.alias,
      title: req.body?.title,
      expiresAt: req.body?.expiresAt,
    });
    res.status(201).json(presentLink(link));
  } catch (error) {
    next(error);
  }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const link = await getLink(requireSlugParam(req.params.slug));
    if (!link) throw notFound('Short link not found or expired');
    res.json(presentLink(link));
  } catch (error) {
    next(error);
  }
});

router.patch('/:slug', async (req, res, next) => {
  try {
    const link = await updateLink(requireSlugParam(req.params.slug), {
      // `undefined` leaves a field alone; an explicit null clears the expiry.
      targetUrl: req.body?.targetUrl,
      title: req.body?.title,
      expiresAt: Object.hasOwn(req.body ?? {}, 'expiresAt') ? req.body.expiresAt : undefined,
    });
    res.json(presentLink(link));
  } catch (error) {
    next(error);
  }
});

router.delete('/:slug', async (req, res, next) => {
  try {
    await deleteLink(requireSlugParam(req.params.slug));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
