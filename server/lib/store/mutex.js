const chains = new Map();

/**
 * Serializes read-modify-write cycles for one record key inside this process.
 *
 * The original implementation rewrote a single workspaces.json on every call,
 * so two concurrent uploads could clobber each other. Records are now keyed
 * individually and each key's updates are queued, which removes the lost-update
 * window for a single-instance deployment. It does not coordinate across
 * processes or across Netlify function instances; see README for that caveat.
 */
export function withLock(key, task) {
  const previous = chains.get(key) ?? Promise.resolve();
  const current = previous.then(task, task);

  // Keep the chain alive but never let a rejection bubble into the next waiter.
  const link = current.catch(() => undefined);
  chains.set(key, link);

  link.then(() => {
    if (chains.get(key) === link) chains.delete(key);
  });

  return current;
}
