"use client";

import * as React from "react";

import { startServiceWorkerAutoUpdate } from "@/lib/service-worker-update";

/**
 * Registers the Serwist-built service worker (`/sw.js`) and keeps the page on the
 * current build.
 *
 * Updates are silent: there is no "a new version is ready" prompt. The worker
 * activates as soon as it installs (`skipWaiting`) and posts a message back only
 * when the new build actually invalidated app-shell assets an open tab could
 * still lazy-load — see `src/lib/sw-shell.ts` for why that is the trigger rather
 * than "a new worker exists". Everything except that decision lives in
 * `service-worker-update.ts`, which is where it is tested.
 *
 * The worker only exists in the production static export (`serwist build` writes
 * `out/sw.js`), so this is a no-op under `next dev`.
 */
export function ServiceWorkerRegistrar() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let update: { dispose: () => void } | undefined;
    const start = () => {
      update = startServiceWorkerAutoUpdate({
        host: navigator.serviceWorker,
        reload: () => window.location.reload(),
      });
    };

    // Defer past load so SW install never competes with the initial render.
    if (document.readyState === "complete") {
      start();
    } else {
      window.addEventListener("load", start, { once: true });
    }

    return () => {
      window.removeEventListener("load", start);
      update?.dispose();
    };
  }, []);

  return null;
}
