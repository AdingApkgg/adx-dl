/**
 * Client half of the silent service-worker auto-update.
 *
 * Registers `/sw.js`, asks it for a newer build on a slow poll, and reloads the
 * page when the worker reports that the app shell actually changed (see
 * `sw-shell.ts` for why that condition, and not "a new worker exists").
 *
 * Kept out of the React component so it can be driven by a fake container in
 * tests — the component has no DOM to render, and bun's test runner has no
 * `navigator.serviceWorker`.
 */
import { SHELL_UPDATED_MESSAGE } from "./sw-shell";

/** How often an open tab asks the server whether a newer worker exists. */
export const UPDATE_POLL_MS = 30 * 60 * 1000;

/**
 * The slice of `navigator.serviceWorker` this module uses. Declared with method
 * shorthand so a hand-rolled test double is assignable both ways.
 */
export type ServiceWorkerUpdateHost = {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  register(scriptUrl: string, options?: { scope?: string }): Promise<{ update(): Promise<unknown> }>;
  startMessages?(): void;
};

export type ServiceWorkerUpdateOptions = {
  host: ServiceWorkerUpdateHost;
  reload: () => void;
  scriptUrl?: string;
  scope?: string;
  pollMs?: number;
  schedule?: (callback: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
};

export type ServiceWorkerAutoUpdate = {
  /** Resolves once registration has settled, successfully or not. */
  ready: Promise<void>;
  dispose: () => void;
};

function isShellUpdatedMessage(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === SHELL_UPDATED_MESSAGE
  );
}

export function startServiceWorkerAutoUpdate({
  host,
  reload,
  scriptUrl = "/sw.js",
  scope = "/",
  pollMs = UPDATE_POLL_MS,
  schedule = (callback, ms) => setInterval(callback, ms),
  cancel = (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}: ServiceWorkerUpdateOptions): ServiceWorkerAutoUpdate {
  let disposed = false;
  let reloaded = false;
  let pollHandle: unknown;

  const onMessage = (event: MessageEvent) => {
    // One reload per page lifetime: a second activation racing the first would
    // otherwise reload a page that is already navigating away.
    if (disposed || reloaded || !isShellUpdatedMessage(event.data)) return;
    reloaded = true;
    reload();
  };

  host.addEventListener("message", onMessage);
  // A page that listens with addEventListener rather than assigning `onmessage`
  // has its worker messages queued until this runs. Without it the reload signal
  // simply never arrives.
  host.startMessages?.();

  const ready = host
    .register(scriptUrl, { scope })
    .then((registration) => {
      if (disposed) return;
      pollHandle = schedule(() => {
        registration.update().catch(() => {
          // Offline, or the server is down — the next poll retries.
        });
      }, pollMs);
    })
    .catch(() => {
      // Registration is a progressive enhancement: a preview deploy without the
      // `serwist build` step 404s on /sw.js, and the site works fine without it.
    });

  return {
    ready,
    dispose: () => {
      disposed = true;
      host.removeEventListener("message", onMessage);
      if (pollHandle !== undefined) {
        cancel(pollHandle);
        pollHandle = undefined;
      }
    },
  };
}
