"use client";

import { RefreshCwIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { getDictionary, type Locale } from "@/lib/i18n";

/** How often an open tab asks the server whether a newer worker exists. */
const UPDATE_POLL_MS = 30 * 60 * 1000;

/**
 * Registers the Serwist-built service worker (`/sw.js`) and owns the
 * "a new version is ready" prompt.
 *
 * The worker no longer calls `skipWaiting()` (see src/sw.ts): activating a new
 * build immediately deletes the previous build's precached chunks, which breaks
 * lazy loading in every tab that is already open. Instead the new worker parks
 * in `waiting`, this component notices and offers a reload, and only then posts
 * SKIP_WAITING — so the swap happens at a moment the user chose.
 *
 * The worker only exists in the production static export (`serwist build`
 * writes `out/sw.js`), so everything here is a no-op under `next dev`.
 */
export function ServiceWorkerRegistrar({ locale }: { locale: Locale }) {
  const [waiting, setWaiting] = React.useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let disposed = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    // Guards the post-activation reload: `controllerchange` also fires on the
    // very first registration of a page that had no controller, and reloading
    // there would be a pointless flash.
    let reloading = false;

    const promptFor = (worker: ServiceWorker | null) => {
      // No existing controller means this is the first install, not an update —
      // there is nothing for the user to reload into.
      if (!worker || !navigator.serviceWorker.controller || disposed) return;
      setWaiting(worker);
    };

    const watchInstalling = (worker: ServiceWorker) => {
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") promptFor(worker);
      });
    };

    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          if (disposed) return;
          promptFor(reg.waiting);
          reg.addEventListener("updatefound", () => {
            if (reg.installing) watchInstalling(reg.installing);
          });
          pollTimer = setInterval(() => {
            reg.update().catch(() => {
              // Offline or the server is down — the next poll retries.
            });
          }, UPDATE_POLL_MS);
        })
        .catch(() => {
          // Registration is a progressive enhancement — ignore failures (e.g.
          // the worker 404ing on a preview deploy without the SW build step).
        });
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Defer past load so SW install never competes with the initial render.
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      disposed = true;
      if (pollTimer) clearInterval(pollTimer);
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!waiting || dismissed) return null;

  const copy = getDictionary(locale).swUpdate;

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md flex-wrap items-center gap-3 rounded-lg border border-border bg-card/95 px-4 py-3 text-sm shadow-lg backdrop-blur sm:inset-x-auto sm:right-4"
    >
      <RefreshCwIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
      <p className="flex-1 min-w-40">{copy.message}</p>
      <Button size="sm" onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}>
        {copy.action}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
        {copy.dismiss}
      </Button>
    </div>
  );
}
