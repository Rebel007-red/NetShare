import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { badRequest } from './errors.js';

const MIN_LENGTH = 4;
const MAX_LENGTH = 32;
const KEY_LENGTH = 32;

/** How long a correct PIN keeps a browser unlocked. */
export const UNLOCK_SECONDS = 12 * 60 * 60;

export function normalizePin(input) {
  const pin = String(input ?? '').trim();
  if (pin.length < MIN_LENGTH || pin.length > MAX_LENGTH) {
    throw badRequest(`A PIN must be ${MIN_LENGTH} to ${MAX_LENGTH} characters`);
  }
  return pin;
}

/** Salted scrypt, so a stored record never reveals or lets anyone replay a PIN. */
export function hashPin(pin) {
  const salt = randomBytes(16);
  return {
    pinSalt: salt.toString('hex'),
    pinHash: scryptSync(pin, salt, KEY_LENGTH).toString('hex'),
  };
}

export function pinMatches(record, pin) {
  if (!record?.pinHash) return true;
  const expected = Buffer.from(record.pinHash, 'hex');
  const actual = scryptSync(String(pin ?? ''), Buffer.from(record.pinSalt, 'hex'), KEY_LENGTH);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * What the unlock cookie holds. It is derived from the stored hash, so it cannot
 * be forged without that hash, and changing or clearing the PIN invalidates every
 * cookie already handed out.
 */
export function unlockToken(record, code) {
  return createHash('sha256').update(`${record.pinHash}:${code}`).digest('hex');
}

export function cookieName(code) {
  return `nfs_pin_${code}`;
}

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return '';
}

export function setUnlockCookie(req, res, record, code) {
  const attributes = [
    `${cookieName(code)}=${unlockToken(record, code)}`,
    'Path=/',
    `Max-Age=${UNLOCK_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (req.secure) attributes.push('Secure');
  res.append('Set-Cookie', attributes.join('; '));
}

export function clearUnlockCookie(res, code) {
  res.append('Set-Cookie', `${cookieName(code)}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}
