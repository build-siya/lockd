// Minimal service worker so Lockd can be installed to the home screen.
// Network-first: always serve the latest version when online.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
