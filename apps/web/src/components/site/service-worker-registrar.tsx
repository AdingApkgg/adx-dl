"use client";

import { useEffect } from "react";

/**
 * Registers the Serwist-built service worker (`/sw.js`) on the client.
 *
 * Renders nothing. The worker only exists in the production static export
 * (`serwist build` writes `out/sw.js`), so registration is a no-op under
 * `next dev`. Kept side-effect-only and mounted once from the root layout.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Registration is a progressive enhancement — ignore failures (e.g. the
        // worker 404ing on a preview deploy without the SW build step).
      });
    };

    // Defer past load so SW install never competes with the initial render.
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
