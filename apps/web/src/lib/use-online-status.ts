"use client";

import * as React from "react";

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

/**
 * `navigator.onLine` as a React value.
 *
 * The server snapshot is `true` on purpose: a static export is prerendered
 * online, and starting from "offline" would flash a warning bar at every
 * visitor during hydration.
 *
 * Caveat worth remembering at call sites — `onLine === true` only means the
 * device has *a* network interface up, not that our origin is reachable. Use it
 * to explain a failure that already happened, never to predict one.
 */
export function useOnlineStatus(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => true);
}
