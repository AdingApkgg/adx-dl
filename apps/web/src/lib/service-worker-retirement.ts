type RetirementWorker = { scriptURL: string; postMessage?: (data: unknown) => void };

type RetirementRegistration = {
  scope: string;
  active: RetirementWorker | null;
  waiting: RetirementWorker | null;
  installing: RetirementWorker | null;
  update: () => Promise<unknown>;
};

export type ServiceWorkerRetirementHost = {
  getRegistrations: () => Promise<readonly RetirementRegistration[]>;
};

/** Ask only an existing archive worker to fetch its replacement at /sw.js.
 * Never register a worker for new visitors or unregister one before its cleanup.
 */
export async function retireLegacyServiceWorkers(
  host: ServiceWorkerRetirementHost,
  origin: string,
): Promise<void> {
  try {
    const scope = new URL("/", origin).href;
    const script = new URL("sw.js", scope).href;
    const registrations = await host.getRegistrations();
    await Promise.all(registrations.map(async (registration) => {
      const latest = registration.installing ?? registration.waiting ?? registration.active;
      if (registration.scope !== scope || latest?.scriptURL !== script) return;

      try {
        await registration.update();
      } catch {
        // Offline: retry on the next page load or when the connection returns.
      }
      // Also retry cleanup if the passive replacement previously hit a storage
      // error. Older caching workers ignore this message; activation does the
      // initial cleanup once the replacement is installed.
      registration.active?.postMessage?.({ type: "astrodx-retire-service-worker" });
    }));
  } catch {
    // Storage policies or a concurrent unregister must not break the page.
  }
}
