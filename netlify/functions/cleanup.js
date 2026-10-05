import { cleanupExpiredLinks } from '../../server/lib/links.js';
import { cleanupExpiredNotes } from '../../server/lib/notes.js';
import { cleanupExpiredWorkspaces } from '../../server/lib/workspaces.js';

/**
 * Scheduled replacement for the setInterval sweep the long-running Node server
 * uses. Expired records are also purged lazily on access, so this only reclaims
 * storage for codes nobody comes back to.
 *
 * The schedule itself is declared in netlify.toml under [functions.cleanup].
 */
export const handler = async () => {
  try {
    const [workspaces, notes, links] = await Promise.all([
      cleanupExpiredWorkspaces(),
      cleanupExpiredNotes(),
      cleanupExpiredLinks(),
    ]);

    console.log(`[netfileshare] cleanup kept ${workspaces} workspaces, ${notes} notes, ${links} links`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, workspaces, notes, links }) };
  } catch (error) {
    console.error('[netfileshare] cleanup failed', error);
    return { statusCode: 500, body: JSON.stringify({ ok: false }) };
  }
};
