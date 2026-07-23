import {
  CUSTOM_DOWNLOAD_SOURCE_ID,
  getDownloadSourceProbeUrl,
  normalizeCustomDownloadSourceUrl,
  type BuiltInDownloadSourceId,
} from "@/lib/download-sources";

export type DownloadSourceProbeState = "idle" | "testing" | "ok" | "timeout" | "error";

export type DownloadSourceProbe = {
  state: DownloadSourceProbeState;
  latencyMs: number | null;
  measuredAt: number | null;
};

export const DOWNLOAD_SOURCE_PROBE_TIMEOUT_MS = 5000;
export const DOWNLOAD_SOURCE_PROBE_TTL_MS = 60_000;

type ProbeOptions = {
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

async function probeUrl(
  url: string,
  options: ProbeOptions = {}
): Promise<Pick<DownloadSourceProbe, "state" | "latencyMs">> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? monotonicNow;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DOWNLOAD_SOURCE_PROBE_TIMEOUT_MS);
  const startedAt = now();

  try {
    const response = await fetcher(url, {
      method: "HEAD",
      mode: "cors",
      cache: "no-store",
      signal: controller.signal,
    });
    if (timedOut) {
      return { state: "timeout", latencyMs: null };
    }
    if (!response.ok) {
      return { state: "error", latencyMs: null };
    }
    return {
      state: "ok",
      latencyMs: Math.max(0, Math.round(now() - startedAt)),
    };
  } catch {
    return {
      state: timedOut ? "timeout" : "error",
      latencyMs: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Measures time to response headers; HEAD avoids downloading the media body. */
export function probeDownloadSource(
  sourceId: BuiltInDownloadSourceId,
  options: ProbeOptions = {}
): Promise<Pick<DownloadSourceProbe, "state" | "latencyMs">> {
  return probeUrl(getDownloadSourceProbeUrl(sourceId), options);
}

/** Runs the same path-compatible latency check against a user-defined mirror. */
export function probeCustomDownloadSource(
  baseUrl: string,
  options: ProbeOptions = {}
): Promise<Pick<DownloadSourceProbe, "state" | "latencyMs">> {
  const normalized = normalizeCustomDownloadSourceUrl(baseUrl);
  if (normalized === null) {
    return Promise.resolve({ state: "error", latencyMs: null });
  }
  return probeUrl(
    getDownloadSourceProbeUrl(CUSTOM_DOWNLOAD_SOURCE_ID, normalized),
    options
  );
}
