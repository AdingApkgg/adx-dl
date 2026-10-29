import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { retireLegacyServiceWorkers } from "./service-worker-retirement";

const ORIGIN = "https://archive.example";

function registration(script = `${ORIGIN}/sw.js`, scope = `${ORIGIN}/`) {
  const messages: unknown[] = [];
  let updates = 0;
  return {
    scope,
    active: { scriptURL: script, postMessage: (data: unknown) => messages.push(data) },
    waiting: null,
    installing: null,
    update: async () => { updates += 1; },
    get updates() { return updates; },
    messages,
  };
}

describe("legacy service worker retirement from a page", () => {
  test("new visitors never register a worker", async () => {
    let registrations = 0;
    const host = { getRegistrations: async () => [], register: () => { registrations += 1; } };
    await retireLegacyServiceWorkers(host, ORIGIN);
    expect(registrations).toBe(0);
  });

  test("updates only this site's original root worker", async () => {
    const legacy = registration();
    const otherScript = registration(`${ORIGIN}/other.js`);
    const otherScope = registration(`${ORIGIN}/sw.js`, `${ORIGIN}/other/`);
    const otherOrigin = registration("https://other.example/sw.js", "https://other.example/");
    await retireLegacyServiceWorkers({ getRegistrations: async () => [legacy, otherScript, otherScope, otherOrigin] }, ORIGIN);
    expect([legacy.updates, otherScript.updates, otherScope.updates, otherOrigin.updates]).toEqual([1, 0, 0, 0]);
    expect(legacy.messages).toEqual([{ type: "astrodx-retire-service-worker" }]);
  });

  test("does not interfere with a different worker replacing the old registration", async () => {
    const legacy = { ...registration(), installing: { scriptURL: `${ORIGIN}/other.js` } };
    await retireLegacyServiceWorkers({ getRegistrations: async () => [legacy] }, ORIGIN);
    expect(legacy.messages).toEqual([]);
  });

  test("handles a first installation that has not activated yet", async () => {
    let updates = 0;
    await retireLegacyServiceWorkers({ getRegistrations: async () => [{ scope: `${ORIGIN}/`, active: null, waiting: { scriptURL: `${ORIGIN}/sw.js` }, installing: null, update: async () => { updates += 1; } }] }, ORIGIN);
    expect(updates).toBe(1);
  });

  test("offline update failures do not break the page and a later call retries", async () => {
    const legacy = registration();
    let attempts = 0;
    legacy.update = async () => { if (++attempts === 1) throw new Error("offline"); };
    const host = { getRegistrations: async () => [legacy] };
    await retireLegacyServiceWorkers(host, ORIGIN);
    await retireLegacyServiceWorkers(host, ORIGIN);
    expect(attempts).toBe(2);
    expect(legacy.messages.length).toBeGreaterThan(0);
  });

  test("blocked access to registrations is a harmless no-op", async () => {
    await retireLegacyServiceWorkers({ getRegistrations: async () => { throw new Error("storage blocked"); } }, ORIGIN);
  });
});

type LifecycleEvent = { data?: unknown; waitUntil: (promise: Promise<unknown>) => void };

function worker() {
  const cacheNames = new Set([
    "next-static", "rsc-payloads", "catalog-manifests", "cover-images", "static-images", "fonts", "pages", "astrodx-shell-state",
    `serwist-precache-v2-${ORIGIN}/`,
    "unrelated-cache", `serwist-precache-v2-${ORIGIN}/other/`, "pages-backup",
  ]);
  const listeners = new Map<string, (event: LifecycleEvent) => void>();
  const actions: string[] = [];
  let failDelete = false;
  const self = {
    registration: { scope: `${ORIGIN}/`, unregister: async () => { actions.push("unregister"); return true; } },
    skipWaiting: async () => { actions.push("skipWaiting"); },
    clients: { claim: async () => { actions.push("claim"); } },
    addEventListener: (type: string, listener: (event: LifecycleEvent) => void) => listeners.set(type, listener),
  };
  runInNewContext(readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"), {
    self,
    caches: {
      keys: async () => [...cacheNames],
      delete: async (name: string) => {
        if (failDelete && name === "pages") throw new Error("storage unavailable");
        actions.push(`delete:${name}`);
        return cacheNames.delete(name);
      },
    },
  });
  return {
    cacheNames, actions, listeners,
    set failDelete(value: boolean) { failDelete = value; },
    async dispatch(type: string, data?: unknown) {
      const pending: Promise<unknown>[] = [];
      listeners.get(type)?.({ data, waitUntil: (promise) => pending.push(promise) });
      await Promise.all(pending);
    },
  };
}

describe("the shipped retirement worker", () => {
  test("replaces the old worker without intercepting requests or reloading tabs", async () => {
    const host = worker();
    expect(host.listeners.has("fetch")).toBe(false);
    await host.dispatch("install");
    await host.dispatch("activate");
    expect(host.actions[0]).toBe("skipWaiting");
    expect(host.actions.indexOf("claim")).toBeLessThan(host.actions.indexOf("delete:pages"));
    expect(host.actions.at(-1)).toBe("unregister");
    // No IndexedDB, localStorage, OPFS or navigation APIs exist in this realm:
    // any accidental user-data cleanup or forced reload fails this execution.
    expect([...host.cacheNames].sort()).toEqual(["pages-backup", `serwist-precache-v2-${ORIGIN}/other/`, "unrelated-cache"].sort());
  });

  test("failed cleanup keeps a passive worker and a message can retry it", async () => {
    const host = worker();
    host.failDelete = true;
    await host.dispatch("activate");
    expect(host.actions).not.toContain("unregister");
    expect(host.cacheNames.has("pages")).toBe(true);
    host.failDelete = false;
    await host.dispatch("message", { type: "astrodx-retire-service-worker" });
    expect(host.cacheNames.has("pages")).toBe(false);
    expect(host.actions.at(-1)).toBe("unregister");
  });

  test("unrelated messages cannot trigger cleanup", async () => {
    const host = worker();
    await host.dispatch("message", { type: "other" });
    expect(host.actions).toEqual([]);
  });
});
