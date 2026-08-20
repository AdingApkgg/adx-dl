import { describe, expect, test } from "bun:test";

import { startServiceWorkerAutoUpdate, type ServiceWorkerUpdateHost } from "./service-worker-update";
import { SHELL_UPDATED_MESSAGE } from "./sw-shell";

type FakeRegistration = { update: () => Promise<void> };

type MessageListener = (event: MessageEvent) => void;

/**
 * The slice of `navigator.serviceWorker` the updater touches.
 *
 * Deliberately not an `EventTarget` subclass: `EventTarget.addEventListener`
 * takes a listener over the base `Event`, which is not assignable to a listener
 * over `MessageEvent`, so the double would not typecheck against the host type
 * the production code actually depends on.
 */
class FakeContainer implements ServiceWorkerUpdateHost {
  updateCalls = 0;
  startMessagesCalls = 0;
  registerCalls: string[] = [];

  private readonly listeners = new Set<MessageListener>();

  constructor(private readonly registration: Promise<FakeRegistration> | null = null) {}

  addEventListener(_type: "message", listener: MessageListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: MessageListener): void {
    this.listeners.delete(listener);
  }

  register(scriptUrl: string): Promise<FakeRegistration> {
    this.registerCalls.push(scriptUrl);
    return (
      this.registration ??
      Promise.resolve<FakeRegistration>({
        update: () => {
          this.updateCalls += 1;
          return Promise.resolve();
        },
      })
    );
  }

  startMessages(): void {
    this.startMessagesCalls += 1;
  }

  dispatch(data: unknown): void {
    const event = new MessageEvent("message", { data });
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  emitShellUpdated(): void {
    this.dispatch({ type: SHELL_UPDATED_MESSAGE });
  }
}

/** Captures the polling callback instead of arming a real timer. */
function fakeTimers() {
  const scheduled: { callback: () => void; ms: number }[] = [];
  const cancelled: unknown[] = [];
  return {
    scheduled,
    cancelled,
    schedule: (callback: () => void, ms: number) => {
      scheduled.push({ callback, ms });
      return scheduled.length - 1;
    },
    cancel: (handle: unknown) => {
      cancelled.push(handle);
    },
  };
}

function start(host: ServiceWorkerUpdateHost, reload: () => void, timers = fakeTimers()) {
  const update = startServiceWorkerAutoUpdate({
    host,
    reload,
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  return { update, timers };
}

describe("startServiceWorkerAutoUpdate", () => {
  test("registers the worker and starts message delivery", async () => {
    const host = new FakeContainer();
    const { update } = start(host, () => {});
    await update.ready;

    expect(host.registerCalls).toEqual(["/sw.js"]);
    // Messages posted to a page that only uses addEventListener stay queued
    // until startMessages() runs — without it the reload signal never arrives.
    expect(host.startMessagesCalls).toBe(1);

    update.dispose();
  });

  test("reloads when the worker reports a changed app shell", async () => {
    let reloads = 0;
    const host = new FakeContainer();
    const { update } = start(host, () => {
      reloads += 1;
    });
    await update.ready;

    host.emitShellUpdated();

    expect(reloads).toBe(1);
    update.dispose();
  });

  test("reloads at most once", async () => {
    let reloads = 0;
    const host = new FakeContainer();
    const { update } = start(host, () => {
      reloads += 1;
    });
    await update.ready;

    host.emitShellUpdated();
    host.emitShellUpdated();

    expect(reloads).toBe(1);
    update.dispose();
  });

  test("ignores unrelated worker messages", async () => {
    let reloads = 0;
    const host = new FakeContainer();
    const { update } = start(host, () => {
      reloads += 1;
    });
    await update.ready;

    host.dispatch({ type: "something-else" });
    host.dispatch(null);
    host.dispatch("plain string");

    expect(reloads).toBe(0);
    update.dispose();
  });

  test("polls the registration for a newer worker", async () => {
    const host = new FakeContainer();
    const { update, timers } = start(host, () => {});
    await update.ready;

    expect(timers.scheduled).toHaveLength(1);
    expect(timers.scheduled[0]?.ms).toBe(30 * 60 * 1000);

    timers.scheduled[0]?.callback();
    await Promise.resolve();

    expect(host.updateCalls).toBe(1);
    update.dispose();
  });

  test("survives a failed registration", async () => {
    const host = new FakeContainer(Promise.reject(new Error("404")));
    const { update, timers } = start(host, () => {});

    // A preview deploy without the SW build step 404s on /sw.js; registration is
    // a progressive enhancement, so that must not reject or arm a poll.
    await update.ready;

    expect(timers.scheduled).toHaveLength(0);
    update.dispose();
  });

  test("stops reloading and polling once disposed", async () => {
    let reloads = 0;
    const host = new FakeContainer();
    const { update, timers } = start(host, () => {
      reloads += 1;
    });
    await update.ready;

    update.dispose();
    host.emitShellUpdated();

    expect(reloads).toBe(0);
    expect(timers.cancelled).toEqual([0]);
  });

  test("does not poll when disposed before registration settles", async () => {
    let resolveRegistration: (registration: FakeRegistration) => void = () => {};
    const pending = new Promise<FakeRegistration>((resolve) => {
      resolveRegistration = resolve;
    });
    const host = new FakeContainer(pending);
    const { update, timers } = start(host, () => {});

    update.dispose();
    resolveRegistration({ update: () => Promise.resolve() });
    await update.ready;

    expect(timers.scheduled).toHaveLength(0);
  });
});
