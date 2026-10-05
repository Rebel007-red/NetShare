import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from './app.js';
import { CLEANUP_INTERVAL_MS, DIST_DIR, PORT, STORE_DRIVER } from './lib/config.js';
import { cleanupExpiredLinks } from './lib/links.js';
import { cleanupExpiredNotes } from './lib/notes.js';
import { cleanupExpiredWorkspaces } from './lib/workspaces.js';

async function hasBuiltFrontend() {
  try {
    await fs.access(path.join(DIST_DIR, 'index.html'));
    return true;
  } catch {
    return false;
  }
}

async function runCleanup() {
  await Promise.all([
    cleanupExpiredWorkspaces(),
    cleanupExpiredNotes(),
    cleanupExpiredLinks(),
  ]);
}

const app = createApp();

// Serve the built frontend when it exists, so `npm run start:prod` and the
// Docker image can run the whole app from one port.
if (await hasBuiltFrontend()) {
  app.use(express.static(DIST_DIR, { index: false }));
  // Everything that is not an API call or a short link falls through to the SPA.
  app.get(/^(?!\/(?:api|s)\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

await runCleanup().catch((error) => console.error('[netfileshare] initial cleanup failed', error));

setInterval(() => {
  runCleanup().catch((error) => console.error('[netfileshare] cleanup failed', error));
}, CLEANUP_INTERVAL_MS).unref();

app.listen(PORT, () => {
  console.log(`NetFileShare listening on http://localhost:${PORT} (store: ${STORE_DRIVER})`);
});
