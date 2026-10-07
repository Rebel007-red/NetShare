import express from 'express';
import { withActivity } from '../lib/activity.js';
import { notFound, unauthorized } from '../lib/errors.js';
import { isValidCode, normalizeCode } from '../lib/ids.js';
import {
  clearUnlockCookie,
  hashPin,
  normalizePin,
  pinMatches,
  readCookie,
  cookieName,
  setUnlockCookie,
  unlockToken,
} from '../lib/pin.js';
import { getStore } from '../lib/store/index.js';

/** A PIN lookup is cached this long, so polling does not double every read. */
const CACHE_MS = 5000;

/**
 * Optional PIN protection for one workspace or note.
 *
 * It sits in front of every route under `/<base>/:code`: a request needs a cookie
 * proving the PIN was entered, or it is refused with `pin_required`. The client
 * answers that by asking for the PIN and POSTing it to `/unlock`, which sets the
 * cookie. A cookie (not a header) is used so that plain links — downloads, image
 * previews, ZIPs — work without any script involved.
 *
 * This deliberately bends "the code is the access key": it is for the rare share
 * that needs a second factor. Anyone who knows the code can still set or clear a
 * PIN once unlocked, exactly as they can delete the item.
 */
export function createPinSupport({ keyFor, mutate, present, label }) {
  const cache = new Map();

  async function loadPinned(code) {
    const cached = cache.get(code);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.record;
    const record = await getStore().getRecord(keyFor(code));
    cache.set(code, { record: record?.pinHash ? record : null, at: Date.now() });
    return record?.pinHash ? record : null;
  }

  /** Middleware: lets a request through only if it is not protected or is unlocked. */
  async function gate(req, _res, next) {
    try {
      const code = normalizeCode(req.params.code);
      if (!isValidCode(code) || req.path === '/unlock') return next();

      const record = await loadPinned(code);
      if (!record) return next();
      if (readCookie(req, cookieName(code)) === unlockToken(record, code)) return next();
      return next(unauthorized(`This ${label} is protected by a PIN`, 'pin_required'));
    } catch (error) {
      return next(error);
    }
  }

  const router = express.Router();

  router.post('/:code/unlock', async (req, res, next) => {
    try {
      const code = normalizeCode(req.params.code);
      const record = isValidCode(code) ? await getStore().getRecord(keyFor(code)) : null;
      if (!record) throw notFound(`${label[0].toUpperCase()}${label.slice(1)} not found or expired`);

      if (!record.pinHash || pinMatches(record, req.body?.pin)) {
        if (record.pinHash) setUnlockCookie(req, res, record, code);
        res.status(204).end();
        return;
      }
      // A wrong PIN counts like a wrong code, so it cannot be brute-forced.
      res.locals.miss = true;
      throw unauthorized('That PIN is not right', 'wrong_pin');
    } catch (error) {
      next(error);
    }
  });

  router.post('/:code/pin', async (req, res, next) => {
    try {
      const code = normalizeCode(req.params.code);
      const clearing = req.body?.pin === null || req.body?.pin === '';
      const credentials = clearing ? null : hashPin(normalizePin(req.body?.pin));

      const updated = await mutate(code, (current) => {
        const rest = { ...current };
        delete rest.pinHash;
        delete rest.pinSalt;
        return withActivity(
          credentials ? { ...rest, ...credentials } : rest,
          credentials ? 'pin-set' : 'pin-cleared',
        );
      });

      cache.delete(code);
      // Whoever sets the PIN stays unlocked, so they are not shut out of their own item.
      if (credentials) setUnlockCookie(req, res, updated, code);
      else clearUnlockCookie(res, code);
      res.json(present(updated));
    } catch (error) {
      next(error);
    }
  });

  return { gate, router };
}
