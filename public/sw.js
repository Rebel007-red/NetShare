/*
 * Service worker whose only job is to make the app installable.
 *
 * It deliberately caches nothing. Share codes and API responses must always be
 * live, and a cached app shell could outlive a deploy and talk to an API it no
 * longer matches. Requests simply go to the network, as they would without it.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
// Some browsers only treat a site as installable if a fetch handler exists.
self.addEventListener('fetch', () => {});
