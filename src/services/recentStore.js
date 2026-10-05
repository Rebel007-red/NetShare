const MAX_ENTRIES = 24;

/**
 * Recent workspace codes, note codes and link slugs live in localStorage: the
 * server has no user accounts, so the browser is what remembers which share
 * codes this person created. Every accessor is defensive because localStorage
 * throws in private windows and when site data is blocked.
 */
function read(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function write(key, values) {
  try {
    localStorage.setItem(key, JSON.stringify(values.slice(0, MAX_ENTRIES)));
  } catch {
    // Nothing we can do; the session simply will not remember this code.
  }
}

export function createRecentStore(storageKey, { normalize = (value) => String(value ?? '').trim() } = {}) {
  return {
    list() {
      return read(storageKey).map(normalize).filter(Boolean);
    },

    remember(value) {
      const normalized = normalize(value);
      if (!normalized) return;
      write(storageKey, [normalized, ...read(storageKey).map(normalize).filter((item) => item && item !== normalized)]);
    },

    forget(value) {
      const normalized = normalize(value);
      write(storageKey, read(storageKey).map(normalize).filter((item) => item && item !== normalized));
    },

    /** Replaces the list with the entries the server still knows about. */
    replace(values) {
      write(storageKey, values.map(normalize).filter(Boolean));
    },
  };
}

export function readSingle(key) {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

export function writeSingle(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Ignored, as above.
  }
}
