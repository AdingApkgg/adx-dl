/* Keep this URL available for returning clients, including old installed PWAs.
 * This replacement intentionally has no fetch handler and never reloads tabs.
 * Only Cache Storage owned by the former archive worker is removed: downloads,
 * settings and Serwist's small IndexedDB metadata database are left untouched.
 */
(() => {
  const legacyCaches = new Set([
    "next-static",
    "rsc-payloads",
    "catalog-manifests",
    "cover-images",
    "static-images",
    "fonts",
    "pages",
    "astrodx-shell-state",
    `serwist-precache-v2-${self.registration.scope}`,
  ]);
  let cleanup;

  function retire() {
    if (!cleanup) {
      cleanup = (async () => {
        // Take existing tabs away from the caching worker before deleting its
        // responses. Those tabs keep running; subsequent requests use network.
        await self.clients.claim();
        const names = await caches.keys();
        const results = await Promise.allSettled(
          names.filter((name) => legacyCaches.has(name)).map((name) => caches.delete(name)),
        );
        if (results.some((result) => result.status === "rejected")) return;
        await self.registration.unregister();
      })().catch(() => {
        // Stay passive on failure; the page can send a retry on its next visit.
      }).finally(() => {
        cleanup = undefined;
      });
    }
    return cleanup;
  }

  self.addEventListener("install", (event) => {
    event.waitUntil(self.skipWaiting());
  });
  self.addEventListener("activate", (event) => {
    event.waitUntil(retire());
  });
  self.addEventListener("message", (event) => {
    if (event.data?.type === "astrodx-retire-service-worker") {
      event.waitUntil(retire());
    }
  });
})();
