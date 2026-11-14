import { describe, expect, test } from "bun:test";
import { navigationMotionBootScript } from "./navigation-motion";

function scene(storage = new Map<string, string>(), href = "https://example.test/", now = 1000) {
  const window = new EventTarget() as EventTarget & { setTimeout: (callback: () => void) => number };
  const attributes = new Map<string, string>();
  const timers: (() => void)[] = [];
  window.setTimeout = (callback) => timers.push(callback);
  const document = Object.assign(new EventTarget(), {
    documentElement: {
      dataset: {} as Record<string, string>,
      hasAttribute: (name: string) => attributes.has(name),
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    },
  });
  const sessionStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  };
  new Function("window", "document", "sessionStorage", "location", "URL", "Date", navigationMotionBootScript())(window, document, sessionStorage, new URL(href), URL, { now: () => now });
  function fire(type: string, data: Record<string, unknown> = {}) {
    const event = Object.assign(new Event(type), data);
    window.dispatchEvent(event);
  }
  const swap = (to = "https://example.test/charts", navigationType = "push") => fire("pageswap", { activation: { navigationType, entry: { url: to } } });
  return { attributes, root: document.documentElement, timers, fire, swap };
}

describe("cross-document motion recovery", () => {
  test("animates a same-origin destination once when its native snapshot was lost", () => {
    const storage = new Map<string, string>();
    scene(storage).swap();
    const destination = scene(storage, "https://example.test/charts");
    destination.fire("pagereveal", { viewTransition: null });
    expect(destination.attributes.has("data-navigation-fallback")).toBe(true);
    for (const callback of destination.timers) callback();
    expect(destination.attributes.has("data-navigation-fallback")).toBe(false);
    destination.fire("pagereveal", { viewTransition: null });
    expect(destination.attributes.has("data-navigation-fallback")).toBe(false);
  });

  test("leaves successful native transitions alone", async () => {
    const storage = new Map<string, string>();
    scene(storage).swap();
    const destination = scene(storage, "https://example.test/charts");
    destination.fire("pagereveal", { viewTransition: { ready: Promise.resolve() } });
    await Promise.resolve();
    expect(destination.attributes.has("data-navigation-fallback")).toBe(false);
  });

  test("recovers a native transition whose ready promise rejects", async () => {
    const storage = new Map<string, string>();
    scene(storage).swap();
    const destination = scene(storage, "https://example.test/charts");
    const ready = Promise.reject(new Error("snapshot skipped"));
    void ready.catch(() => {});
    destination.fire("pagereveal", { viewTransition: { ready } });
    await Promise.resolve();
    expect(destination.attributes.has("data-navigation-fallback")).toBe(true);
  });

  test("never invents transitions for direct visits, reload, history traversal or external links", () => {
    for (const [url, type] of [["https://example.test/charts", "reload"], ["https://example.test/charts", "traverse"], ["https://external.test/charts", "push"], ["https://example.test/#section", "push"]]) {
      const storage = new Map<string, string>();
      scene(storage).swap(url, type);
      const destination = scene(storage, url);
      destination.fire("pagereveal", { viewTransition: null });
      expect(destination.attributes.has("data-navigation-fallback")).toBe(false);
    }
    const direct = scene();
    direct.fire("pagereveal", { viewTransition: null });
    expect(direct.attributes.has("data-navigation-fallback")).toBe(false);
  });

  test("respects incoming motion preferences and simple compatibility mode", () => {
    for (const preference of ["reduced", "off", "simple"]) {
      const storage = new Map<string, string>();
      scene(storage).swap();
      const destination = scene(storage, "https://example.test/charts");
      if (preference === "reduced") destination.root.setAttribute("data-reduced-motion", "");
      if (preference === "off") destination.root.dataset.motion = "off";
      if (preference === "simple") destination.root.dataset.compatibility = "simple";
      destination.fire("pagereveal", { viewTransition: null });
      expect(destination.attributes.has("data-navigation-fallback")).toBe(false);
    }
  });

  test("discards stale or mismatched destinations", () => {
    for (const [href, now] of [["https://example.test/other", 1000], ["https://example.test/charts", 40000]] as const) {
      const storage = new Map<string, string>();
      scene(storage).swap();
      const destination = scene(storage, href, now);
      destination.fire("pagereveal", { viewTransition: null });
      expect(destination.attributes.has("data-navigation-fallback")).toBe(false);
    }
  });

  test("does not revive an old failed transition after leaving and restoring a document", async () => {
    const storage = new Map<string, string>();
    scene(storage).swap();
    const destination = scene(storage, "https://example.test/charts");
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((_resolve, reject) => { rejectReady = reject; });
    destination.fire("pagereveal", { viewTransition: { ready } });
    destination.swap("https://example.test/other");
    destination.fire("pagereveal", { viewTransition: null });
    rejectReady(new Error("late snapshot failure"));
    await Promise.resolve();
    expect(destination.attributes.has("data-navigation-fallback")).toBe(false);
  });
});
