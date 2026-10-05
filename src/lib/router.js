/**
 * Minimal pathname router. The app only needs three shapes, so this avoids a
 * router dependency:
 *   /note/<CODE>  a shared note, readable by anyone with the link
 *   /w/<CODE>     an invite link that opens a workspace directly
 *   anything else the main app
 *
 * Netlify's SPA fallback and the Express catch-all both serve index.html for
 * these paths, so they survive a hard refresh.
 */
export function parseRoute(pathname = window.location.pathname) {
  const segments = String(pathname ?? '').split('/').filter(Boolean);

  if (segments.length === 2) {
    const code = segments[1].toUpperCase();
    if (!/^[A-Z1-9]{6}$/.test(code)) return { name: 'app' };
    if (segments[0] === 'note') return { name: 'note', code };
    if (segments[0] === 'w') return { name: 'workspace', code };
  }

  return { name: 'app' };
}

/** Replaces the URL without a reload, so share links can be cleaned up. */
export function replacePath(path) {
  try {
    window.history.replaceState({}, '', path);
  } catch {
    // History is unavailable (sandboxed iframe); the route simply stays.
  }
}
