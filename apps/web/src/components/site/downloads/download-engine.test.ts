import { afterEach, describe, expect, test } from "bun:test";

import {
  runMultiFileDownload,
  type CompletedDownloadFile,
} from "./download-engine";

const FULL = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

type Captured = { url: string; headers: Headers };

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Install a fetch stub and capture each request's URL and headers. */
function stubFetch(handler: (captured: Captured) => Response | Promise<Response>): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const captured: Captured = {
      url: String(url),
      headers: new Headers(init?.headers),
    };
    calls.push(captured);
    return handler(captured);
  }) as typeof fetch;
  return calls;
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("runMultiFileDownload", () => {
  test("fetches every unfinished file from byte zero without Range headers", async () => {
    const calls = stubFetch(
      () => new Response(FULL, { status: 200, headers: { "content-length": "10" } })
    );

    const [result] = await runMultiFileDownload([
      { name: "a", url: "https://x/a", completedBlob: null },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].headers.has("Range")).toBe(false);
    expect(calls[0].headers.has("If-Range")).toBe(false);
    expect([...(await bytesOf(result.blob))]).toEqual([...FULL]);
  });

  test("keeps a completed file and fetches only the unfinished files", async () => {
    const kept = new Blob([new Uint8Array([7, 8, 9])]);
    const calls = stubFetch(
      () => new Response(FULL, { status: 200, headers: { "content-length": "10" } })
    );

    const result = await runMultiFileDownload([
      { name: "kept", url: "https://old/kept", completedBlob: kept },
      { name: "remaining", url: "https://new/remaining", completedBlob: null },
    ]);

    expect(calls.map((call) => call.url)).toEqual(["https://new/remaining"]);
    expect([...(await bytesOf(result[0].blob))]).toEqual([7, 8, 9]);
    expect([...(await bytesOf(result[1].blob))]).toEqual([...FULL]);
  });

  test("recognises an explicitly completed zero-byte file without fetching", async () => {
    const calls = stubFetch(() => new Response(FULL, { status: 200 }));

    const [result] = await runMultiFileDownload([
      { name: "empty", url: "https://x/empty", completedBlob: new Blob([]) },
    ]);

    expect(calls).toHaveLength(0);
    expect(result.blob.size).toBe(0);
  });

  test("emits one whole-file checkpoint and waits for its async write", async () => {
    stubFetch(() => new Response(FULL, { status: 200 }));
    let releaseWrite: (() => void) | undefined;
    let signalStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const completedFiles: CompletedDownloadFile[] = [];
    let settled = false;

    const run = runMultiFileDownload(
      [{ name: "a", url: "https://x/a", completedBlob: null }],
      {
        onFileComplete: async (file) => {
          completedFiles.push(file);
          signalStarted?.();
          await release;
        },
      }
    ).then((value) => {
      settled = true;
      return value;
    });

    await writeStarted;
    expect(settled).toBe(false);
    expect(completedFiles).toHaveLength(1);
    expect([...(await bytesOf(completedFiles[0].blob))]).toEqual([...FULL]);
    releaseWrite?.();
    await run;
    expect(settled).toBe(true);
  });

  test("does not checkpoint an interrupted prefix and retries it from zero", async () => {
    const abortController = new AbortController();
    let partialDelivered: (() => void) | undefined;
    const delivered = new Promise<void>((resolve) => {
      partialDelivered = resolve;
    });
    let completed = 0;

    globalThis.fetch = (async (_url, init) => {
      const signal = init?.signal;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(FULL.slice(0, 4));
          partialDelivered?.();
          signal?.addEventListener("abort", () => {
            controller.error(new DOMException("Aborted", "AbortError"));
          });
        },
      });
      return new Response(stream, { status: 200, headers: { "content-length": "10" } });
    }) as typeof fetch;

    const interrupted = runMultiFileDownload(
      [{ name: "a", url: "https://x/a", completedBlob: null }],
      {
        signal: abortController.signal,
        onFileComplete: () => {
          completed += 1;
        },
      }
    );
    await delivered;
    abortController.abort();
    await expect(interrupted).rejects.toThrow();
    expect(completed).toBe(0);

    const retryCalls = stubFetch(() => new Response(FULL, { status: 200 }));
    await runMultiFileDownload([
      { name: "a", url: "https://x/a", completedBlob: null },
    ]);
    expect(retryCalls).toHaveLength(1);
    expect(retryCalls[0].headers.has("Range")).toBe(false);
    expect(retryCalls[0].headers.has("If-Range")).toBe(false);
  });

  test("rejects an unsolicited partial response instead of archiving it", async () => {
    stubFetch(
      () =>
        new Response(FULL.slice(4), {
          status: 206,
          headers: { "content-range": "bytes 4-9/10" },
        })
    );
    let completed = 0;

    await expect(
      runMultiFileDownload(
        [{ name: "a", url: "https://x/a", completedBlob: null }],
        { onFileComplete: () => void (completed += 1) }
      )
    ).rejects.toThrow("File download failed");
    expect(completed).toBe(0);
  });

  test("retries a transient network failure and succeeds", async () => {
    let attempts = 0;
    const calls = stubFetch(() => {
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError("Failed to fetch");
      }
      return new Response(FULL, { status: 200, headers: { "content-length": "10" } });
    });

    const [result] = await runMultiFileDownload(
      [{ name: "a", url: "https://x/a", completedBlob: null }],
      { retryBaseDelayMs: 1 }
    );

    expect(calls).toHaveLength(2);
    expect([...(await bytesOf(result.blob))]).toEqual([...FULL]);
  });

  test("retries a 503 response and succeeds on the next attempt", async () => {
    let attempts = 0;
    const calls = stubFetch(() => {
      attempts += 1;
      if (attempts === 1) {
        return new Response("busy", { status: 503 });
      }
      return new Response(FULL, { status: 200, headers: { "content-length": "10" } });
    });

    const [result] = await runMultiFileDownload(
      [{ name: "a", url: "https://x/a", completedBlob: null }],
      { retryBaseDelayMs: 1 }
    );

    expect(calls).toHaveLength(2);
    expect([...(await bytesOf(result.blob))]).toEqual([...FULL]);
  });

  test("gives up after consecutive attempts that make no progress", async () => {
    const calls = stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });

    await expect(
      runMultiFileDownload(
        [{ name: "a", url: "https://x/a", completedBlob: null }],
        { retryBaseDelayMs: 1 }
      )
    ).rejects.toThrow("File download failed");
    expect(calls).toHaveLength(4);
  });

  test("does not retry a definitive HTTP error such as 404", async () => {
    const calls = stubFetch(() => new Response("missing", { status: 404 }));

    await expect(
      runMultiFileDownload(
        [{ name: "a", url: "https://x/a", completedBlob: null }],
        { retryBaseDelayMs: 1 }
      )
    ).rejects.toThrow("File download failed");
    expect(calls).toHaveLength(1);
  });

  /** A response whose stream delivers `bytes` and then errors mid-transfer. */
  function interruptedResponse(bytes: Uint8Array, headers: Record<string, string>, status = 200) {
    let delivered = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Erroring in the same tick as enqueue would discard the queued chunk;
        // deliver it on the first read and fail on the next one instead.
        if (!delivered) {
          delivered = true;
          controller.enqueue(bytes);
          return;
        }
        controller.error(new TypeError("network error"));
      },
    });
    return new Response(stream, { status, headers });
  }

  test("resumes an interrupted body with Range/If-Range when a validator exists", async () => {
    const lastModified = "Wed, 01 Jan 2025 00:00:00 GMT";
    let attempts = 0;
    const calls = stubFetch(() => {
      attempts += 1;
      if (attempts === 1) {
        return interruptedResponse(FULL.slice(0, 4), {
          "content-length": "10",
          "last-modified": lastModified,
        });
      }
      return new Response(FULL.slice(4), {
        status: 206,
        headers: { "content-range": "bytes 4-9/10" },
      });
    });

    const [result] = await runMultiFileDownload(
      [{ name: "a", url: "https://x/a", completedBlob: null }],
      { retryBaseDelayMs: 1 }
    );

    expect(calls).toHaveLength(2);
    expect(calls[0].headers.has("Range")).toBe(false);
    expect(calls[1].headers.get("Range")).toBe("bytes=4-");
    expect(calls[1].headers.get("If-Range")).toBe(lastModified);
    expect([...(await bytesOf(result.blob))]).toEqual([...FULL]);
  });

  test("prefers a strong ETag over Last-Modified as the resume validator", async () => {
    let attempts = 0;
    const calls = stubFetch(() => {
      attempts += 1;
      if (attempts === 1) {
        return interruptedResponse(FULL.slice(0, 4), {
          "content-length": "10",
          etag: '"abc123"',
          "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT",
        });
      }
      return new Response(FULL.slice(4), {
        status: 206,
        headers: { "content-range": "bytes 4-9/10" },
      });
    });

    await runMultiFileDownload(
      [{ name: "a", url: "https://x/a", completedBlob: null }],
      { retryBaseDelayMs: 1 }
    );

    expect(calls[1].headers.get("If-Range")).toBe('"abc123"');
  });

  test("restarts from byte zero without Range when no validator is available", async () => {
    let attempts = 0;
    const calls = stubFetch(() => {
      attempts += 1;
      if (attempts === 1) {
        return interruptedResponse(FULL.slice(0, 4), { "content-length": "10" });
      }
      return new Response(FULL, { status: 200, headers: { "content-length": "10" } });
    });

    const [result] = await runMultiFileDownload(
      [{ name: "a", url: "https://x/a", completedBlob: null }],
      { retryBaseDelayMs: 1 }
    );

    expect(calls).toHaveLength(2);
    expect(calls[1].headers.has("Range")).toBe(false);
    expect(calls[1].headers.has("If-Range")).toBe(false);
    expect([...(await bytesOf(result.blob))]).toEqual([...FULL]);
  });

  test("discards the buffered prefix when the server ignores the Range request", async () => {
    let attempts = 0;
    stubFetch(() => {
      attempts += 1;
      if (attempts === 1) {
        return interruptedResponse(FULL.slice(0, 4), {
          "content-length": "10",
          "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT",
        });
      }
      return new Response(FULL, { status: 200, headers: { "content-length": "10" } });
    });

    const [result] = await runMultiFileDownload(
      [{ name: "a", url: "https://x/a", completedBlob: null }],
      { retryBaseDelayMs: 1 }
    );

    // Not 4 prefix bytes + 10 full bytes — the stale prefix must be dropped.
    expect([...(await bytesOf(result.blob))]).toEqual([...FULL]);
  });

  test("treats a cleanly-closed short 206 as truncated and keeps resuming", async () => {
    const lastModified = "Wed, 01 Jan 2025 00:00:00 GMT";
    let attempts = 0;
    const calls = stubFetch(() => {
      attempts += 1;
      if (attempts === 1) {
        return interruptedResponse(FULL.slice(0, 4), {
          "content-length": "10",
          "last-modified": lastModified,
        });
      }
      if (attempts === 2) {
        // Continuation closes cleanly after 2 of the remaining 6 bytes.
        return new Response(FULL.slice(4, 6), {
          status: 206,
          headers: { "content-range": "bytes 4-9/10" },
        });
      }
      return new Response(FULL.slice(6), {
        status: 206,
        headers: { "content-range": "bytes 6-9/10" },
      });
    });

    const [result] = await runMultiFileDownload(
      [{ name: "a", url: "https://x/a", completedBlob: null }],
      { retryBaseDelayMs: 1 }
    );

    expect(calls).toHaveLength(3);
    expect(calls[2].headers.get("Range")).toBe("bytes=6-");
    expect([...(await bytesOf(result.blob))]).toEqual([...FULL]);
  });

  test("keeps retrying while every attempt makes progress, beyond the idle budget", async () => {
    const lastModified = "Wed, 01 Jan 2025 00:00:00 GMT";
    let attempts = 0;
    const calls = stubFetch(() => {
      attempts += 1;
      const offset = attempts - 1;
      if (offset === 0) {
        return interruptedResponse(FULL.slice(0, 1), {
          "content-length": "10",
          "last-modified": lastModified,
        });
      }
      if (offset < 9) {
        // Each attempt yields exactly one more byte before failing.
        return interruptedResponse(
          FULL.slice(offset, offset + 1),
          { "content-range": `bytes ${offset}-9/10` },
          206
        );
      }
      return new Response(FULL.slice(9), {
        status: 206,
        headers: { "content-range": "bytes 9-9/10" },
      });
    });

    const [result] = await runMultiFileDownload(
      [{ name: "a", url: "https://x/a", completedBlob: null }],
      { retryBaseDelayMs: 1 }
    );

    // 10 attempts — far beyond the no-progress budget of 4.
    expect(calls).toHaveLength(10);
    expect([...(await bytesOf(result.blob))]).toEqual([...FULL]);
  });

  test("resets and recovers when a 206 continues from the wrong offset", async () => {
    const lastModified = "Wed, 01 Jan 2025 00:00:00 GMT";
    let attempts = 0;
    const calls = stubFetch(() => {
      attempts += 1;
      if (attempts === 1) {
        return interruptedResponse(FULL.slice(0, 4), {
          "content-length": "10",
          "last-modified": lastModified,
        });
      }
      if (attempts === 2) {
        return new Response(FULL.slice(2), {
          status: 206,
          headers: { "content-range": "bytes 2-9/10" },
        });
      }
      return new Response(FULL, { status: 200, headers: { "content-length": "10" } });
    });

    const [result] = await runMultiFileDownload(
      [{ name: "a", url: "https://x/a", completedBlob: null }],
      { retryBaseDelayMs: 1 }
    );

    // Wrong-offset continuation is unusable; the third attempt restarts clean.
    expect(calls).toHaveLength(3);
    expect(calls[2].headers.has("Range")).toBe(false);
    expect([...(await bytesOf(result.blob))]).toEqual([...FULL]);
  });

  test("checks the delivered size even when the 206 total is '*'", async () => {
    const lastModified = "Wed, 01 Jan 2025 00:00:00 GMT";
    let attempts = 0;
    const calls = stubFetch(() => {
      attempts += 1;
      if (attempts === 1) {
        return interruptedResponse(FULL.slice(0, 4), {
          "content-length": "10",
          "last-modified": lastModified,
        });
      }
      if (attempts === 2) {
        // Unknown complete length; the body stops two bytes short of the
        // declared end, so it must not be accepted as a finished file.
        return new Response(FULL.slice(4, 8), {
          status: 206,
          headers: { "content-range": "bytes 4-9/*" },
        });
      }
      return new Response(FULL.slice(8), {
        status: 206,
        headers: { "content-range": "bytes 8-9/*" },
      });
    });

    const [result] = await runMultiFileDownload(
      [{ name: "a", url: "https://x/a", completedBlob: null }],
      { retryBaseDelayMs: 1 }
    );

    expect(calls).toHaveLength(3);
    expect(calls[2].headers.get("Range")).toBe("bytes=8-");
    expect([...(await bytesOf(result.blob))]).toEqual([...FULL]);
  });

  test("rejects a 206 body that overruns the declared range without retrying", async () => {
    const lastModified = "Wed, 01 Jan 2025 00:00:00 GMT";
    let attempts = 0;
    let completed = 0;
    const calls = stubFetch(() => {
      attempts += 1;
      if (attempts === 1) {
        return interruptedResponse(FULL.slice(0, 4), {
          "content-length": "10",
          "last-modified": lastModified,
        });
      }
      // Claims bytes 4-9 but streams the whole 10-byte body.
      return new Response(FULL, {
        status: 206,
        headers: { "content-range": "bytes 4-9/10" },
      });
    });

    await expect(
      runMultiFileDownload(
        [{ name: "a", url: "https://x/a", completedBlob: null }],
        { retryBaseDelayMs: 1, onFileComplete: () => void (completed += 1) }
      )
    ).rejects.toThrow("File download failed");
    // Untrusted bytes end the run immediately — no retry, no checkpoint.
    expect(calls).toHaveLength(2);
    expect(completed).toBe(0);
  });

  test("continues asking for more when the server answers with a partial range", async () => {
    const lastModified = "Wed, 01 Jan 2025 00:00:00 GMT";
    let attempts = 0;
    const calls = stubFetch(() => {
      attempts += 1;
      if (attempts === 1) {
        return interruptedResponse(FULL.slice(0, 4), {
          "content-length": "10",
          "last-modified": lastModified,
        });
      }
      if (attempts === 2) {
        // A complete, honest sub-range: good bytes, file not finished.
        return new Response(FULL.slice(4, 7), {
          status: 206,
          headers: { "content-range": "bytes 4-6/10" },
        });
      }
      return new Response(FULL.slice(7), {
        status: 206,
        headers: { "content-range": "bytes 7-9/10" },
      });
    });

    const [result] = await runMultiFileDownload(
      [{ name: "a", url: "https://x/a", completedBlob: null }],
      { retryBaseDelayMs: 1 }
    );

    expect(calls).toHaveLength(3);
    expect(calls[2].headers.get("Range")).toBe("bytes=7-");
    expect([...(await bytesOf(result.blob))]).toEqual([...FULL]);
  });

  test("never resumes on a weak ETag and ignores Last-Modified alongside it", async () => {
    let attempts = 0;
    const calls = stubFetch(() => {
      attempts += 1;
      if (attempts === 1) {
        return interruptedResponse(FULL.slice(0, 4), {
          "content-length": "10",
          etag: 'W/"weak"',
          "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT",
        });
      }
      return new Response(FULL, { status: 200, headers: { "content-length": "10" } });
    });

    const [result] = await runMultiFileDownload(
      [{ name: "a", url: "https://x/a", completedBlob: null }],
      { retryBaseDelayMs: 1 }
    );

    // A weak ETag disclaims byte identity, so the retry restarts from zero
    // rather than falling back to the Last-Modified date.
    expect(calls).toHaveLength(2);
    expect(calls[1].headers.has("Range")).toBe(false);
    expect(calls[1].headers.has("If-Range")).toBe(false);
    expect([...(await bytesOf(result.blob))]).toEqual([...FULL]);
  });

  test("discards the prefix when a 206 continues a different representation", async () => {
    let attempts = 0;
    const calls = stubFetch(() => {
      attempts += 1;
      if (attempts === 1) {
        return interruptedResponse(FULL.slice(0, 4), {
          "content-length": "10",
          etag: '"v1"',
        });
      }
      if (attempts === 2) {
        // Server ignored If-Range and continued a newer entity.
        return new Response(FULL.slice(4), {
          status: 206,
          headers: { "content-range": "bytes 4-9/10", etag: '"v2"' },
        });
      }
      return new Response(FULL, {
        status: 200,
        headers: { "content-length": "10", etag: '"v2"' },
      });
    });

    const [result] = await runMultiFileDownload(
      [{ name: "a", url: "https://x/a", completedBlob: null }],
      { retryBaseDelayMs: 1 }
    );

    expect(calls).toHaveLength(3);
    expect(calls[2].headers.has("Range")).toBe(false);
    // v1's prefix was never spliced onto v2's tail.
    expect([...(await bytesOf(result.blob))]).toEqual([...FULL]);
  });

  test("recovers from 416 by restarting the file instead of failing the job", async () => {
    let attempts = 0;
    const calls = stubFetch(() => {
      attempts += 1;
      if (attempts === 1) {
        return interruptedResponse(FULL.slice(0, 4), {
          "content-length": "10",
          etag: '"v1"',
        });
      }
      if (attempts === 2) {
        return new Response(null, {
          status: 416,
          headers: { "content-range": "bytes */3" },
        });
      }
      return new Response(FULL, { status: 200, headers: { "content-length": "10" } });
    });

    const [result] = await runMultiFileDownload(
      [{ name: "a", url: "https://x/a", completedBlob: null }],
      { retryBaseDelayMs: 1 }
    );

    expect(calls).toHaveLength(3);
    expect(calls[2].headers.has("Range")).toBe(false);
    expect([...(await bytesOf(result.blob))]).toEqual([...FULL]);
  });

  test("a 416 that was not asked for is a hard failure", async () => {
    const calls = stubFetch(() => new Response(null, { status: 416 }));

    await expect(
      runMultiFileDownload(
        [{ name: "a", url: "https://x/a", completedBlob: null }],
        { retryBaseDelayMs: 1 }
      )
    ).rejects.toThrow("File download failed");
    expect(calls).toHaveLength(1);
  });

  test("aborting during a retry backoff rejects immediately", async () => {
    const abortController = new AbortController();
    let signalFailed: (() => void) | undefined;
    const firstFailed = new Promise<void>((resolve) => {
      signalFailed = resolve;
    });
    const calls = stubFetch(() => {
      signalFailed?.();
      throw new TypeError("Failed to fetch");
    });

    const run = runMultiFileDownload(
      [{ name: "a", url: "https://x/a", completedBlob: null }],
      // A backoff long enough that only an abort — not the timer — can end it.
      { retryBaseDelayMs: 60_000, signal: abortController.signal }
    );
    const settledAt = run.then(
      () => Date.now(),
      () => Date.now()
    );

    await firstFailed;
    const abortedAt = Date.now();
    abortController.abort();
    await expect(run).rejects.toThrow();
    expect((await settledAt) - abortedAt).toBeLessThan(1000);
    // The pending retry never fired after the abort.
    expect(calls).toHaveLength(1);
  });

  test("waits for connectivity instead of spending retries while offline", async () => {
    const listeners = new Map<string, Set<() => void>>();
    const originalWindow = (globalThis as Record<string, unknown>).window;
    const originalNavigator = globalThis.navigator;
    let online = false;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { get onLine() { return online; } },
    });
    (globalThis as Record<string, unknown>).window = {
      addEventListener: (type: string, listener: () => void) => {
        const bucket = listeners.get(type) ?? new Set();
        bucket.add(listener);
        listeners.set(type, bucket);
      },
      removeEventListener: (type: string, listener: () => void) => {
        listeners.get(type)?.delete(listener);
      },
    };

    // Connectivity "returns" repeatedly while the device is in fact still
    // offline, so each wait ends and the engine attempts another fetch.
    const flapping = setInterval(() => {
      for (const listener of [...(listeners.get("online") ?? [])]) {
        listener();
      }
    }, 5);

    try {
      let attempts = 0;
      const calls = stubFetch(() => {
        attempts += 1;
        if (!online) {
          throw new TypeError("Failed to fetch");
        }
        return new Response(FULL, { status: 200, headers: { "content-length": "10" } });
      });

      const run = runMultiFileDownload(
        [{ name: "a", url: "https://x/a", completedBlob: null }],
        { retryBaseDelayMs: 1 }
      );
      let rejected = false;
      void run.catch(() => void (rejected = true));

      // Six consecutive failures — well past MAX_FAILURES_WITHOUT_PROGRESS (4).
      // An outage must not spend the retry budget, so the run stays alive.
      const deadline = Date.now() + 5000;
      while (attempts < 6 && !rejected && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(rejected).toBe(false);
      expect(attempts).toBeGreaterThanOrEqual(6);

      online = true;
      const [result] = await run;
      expect([...(await bytesOf(result.blob))]).toEqual([...FULL]);
      expect(calls.length).toBeGreaterThan(6);
      // Every "online" listener was removed again — no leak across attempts.
      expect(listeners.get("online")?.size ?? 0).toBe(0);
    } finally {
      clearInterval(flapping);
      (globalThis as Record<string, unknown>).window = originalWindow;
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: originalNavigator,
      });
    }
  });

  test("aborts sibling workers and waits for their shutdown before rejecting", async () => {
    let signalSlowStarted: (() => void) | undefined;
    const slowStarted = new Promise<void>((resolve) => {
      signalSlowStarted = resolve;
    });
    let signalSlowAborted: (() => void) | undefined;
    const slowAborted = new Promise<void>((resolve) => {
      signalSlowAborted = resolve;
    });
    let releaseSlow: (() => void) | undefined;
    const slowRelease = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let slowSettled = false;

    globalThis.fetch = (async (input, init) => {
      if (String(input).endsWith("/fail")) {
        await slowStarted;
        throw new Error("primary worker failed");
      }
      signalSlowStarted?.();
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            signalSlowAborted?.();
            void slowRelease.then(() => {
              slowSettled = true;
              reject(new DOMException("Aborted", "AbortError"));
            });
          },
          { once: true }
        );
      });
    }) as typeof fetch;

    const run = runMultiFileDownload(
      [
        { name: "fail", url: "https://x/fail", completedBlob: null },
        { name: "slow", url: "https://x/slow", completedBlob: null },
      ],
      { concurrency: 2 }
    );
    let settled = false;
    void run.then(
      () => void (settled = true),
      () => void (settled = true)
    );

    await slowAborted;
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseSlow?.();
    await expect(run).rejects.toThrow("primary worker failed");
    expect(slowSettled).toBe(true);
  });

  test("skips an optional file the mirror does not have, keeping the rest", async () => {
    stubFetch(({ url }) =>
      url.endsWith("/pv.mp4")
        ? new Response("nope", { status: 404 })
        : new Response(FULL, { status: 200, headers: { "content-length": "10" } })
    );
    const skipped: { name: string; status: number | null }[] = [];

    const archive = await runMultiFileDownload(
      [
        { name: "maidata.txt", url: "https://cdn.test/maidata.txt", completedBlob: null },
        { name: "track.mp3", url: "https://cdn.test/track.mp3", completedBlob: null },
        {
          name: "pv.mp4",
          url: "https://cdn.test/pv.mp4",
          completedBlob: null,
          optional: true,
        },
      ],
      {
        concurrency: 1,
        retryBaseDelayMs: 1,
        onFileSkipped: (file) => skipped.push({ name: file.name, status: file.status }),
      }
    );

    // The archive input list must not carry an empty placeholder for it.
    expect(archive.map((input) => input.name)).toEqual(["maidata.txt", "track.mp3"]);
    expect(skipped).toEqual([{ name: "pv.mp4", status: 404 }]);
  });

  test("a required file's 404 still fails the run, with its status in the message", async () => {
    stubFetch(({ url }) =>
      url.endsWith("/track.mp3")
        ? new Response("nope", { status: 404 })
        : new Response(FULL, { status: 200, headers: { "content-length": "10" } })
    );

    await expect(
      runMultiFileDownload(
        [
          { name: "maidata.txt", url: "https://cdn.test/maidata.txt", completedBlob: null },
          { name: "track.mp3", url: "https://cdn.test/track.mp3", completedBlob: null },
        ],
        { concurrency: 1, retryBaseDelayMs: 1 }
      )
    ).rejects.toThrow("(HTTP 404)");
  });

  test("a skipped optional file never reaches the durable checkpoint callback", async () => {
    stubFetch(({ url }) =>
      url.endsWith("/bg.png")
        ? new Response("nope", { status: 403 })
        : new Response(FULL, { status: 200, headers: { "content-length": "10" } })
    );
    const checkpointed: string[] = [];

    await runMultiFileDownload(
      [
        { name: "track.mp3", url: "https://cdn.test/track.mp3", completedBlob: null },
        {
          name: "bg.png",
          url: "https://cdn.test/bg.png",
          completedBlob: null,
          optional: true,
        },
      ],
      {
        concurrency: 1,
        retryBaseDelayMs: 1,
        onFileComplete: (file: CompletedDownloadFile) => {
          checkpointed.push(file.name);
        },
      }
    );

    expect(checkpointed).toEqual(["track.mp3"]);
  });

  test("extrapolates a total from the files that have declared a size", async () => {
    // Sizes only arrive as each response's headers land, so waiting for all of
    // them pinned the denominator at 0 for most of a run.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubFetch(async ({ url }) => {
      if (url.endsWith("/b.bin")) {
        await gate;
      }
      return new Response(FULL, { status: 200, headers: { "content-length": "10" } });
    });
    const totals: { total: number; estimated: boolean }[] = [];

    const run = runMultiFileDownload(
      [
        { name: "a.bin", url: "https://cdn.test/a.bin", completedBlob: null },
        { name: "b.bin", url: "https://cdn.test/b.bin", completedBlob: null },
      ],
      {
        concurrency: 1,
        onBytes: (_received, total, estimated) => totals.push({ total, estimated }),
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    release?.();
    await run;

    // One measured 10-byte file and one unknown extrapolates to 20, flagged.
    expect(totals).toContainEqual({ total: 20, estimated: true });
    // Once every size is known the flag drops and the number is exact.
    expect(totals.at(-1)).toEqual({ total: 20, estimated: false });
  });
});
