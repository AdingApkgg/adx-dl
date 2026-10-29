"use client";

import * as React from "react";

import { retireLegacyServiceWorkers } from "@/lib/service-worker-retirement";

/** Retires existing production registrations without creating any new ones. */
export function ServiceWorkerRetirement() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    const retire = () => {
      void retireLegacyServiceWorkers(navigator.serviceWorker, window.location.origin);
    };
    if (document.readyState === "complete") {
      retire();
    } else {
      window.addEventListener("load", retire, { once: true });
    }
    window.addEventListener("online", retire);
    return () => {
      window.removeEventListener("load", retire);
      window.removeEventListener("online", retire);
    };
  }, []);

  return null;
}
