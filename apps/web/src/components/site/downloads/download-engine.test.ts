import { afterEach, describe, expect, test } from "bun:test";

import { runResumableDownload, type EngineFlush } from "./download-engine";

const FULL = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

type Captured = { url: string; headers: Record<string, string> };

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Install a fetch stub and capture each request's url + headers. */
function stubFetch(handler: (captured: Captured) => Response): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const captured: Captured = {
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(captured);
    return handler(captured);
  }) as typeof fetch;
  return calls;
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("runResumableDownload", () => {
  test("fresh download fetches the whole file with no Range header", async () => {
    const calls = stubFetch(
      () => new Response(FULL, { status: 200, headers: { "content-length": "10" } })
    );

    const [result] = await runResumableDownload([
      { name: "a", url: "https://x/a", etag: null, total: null, blob: new Blob([]) },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].headers.Range).toBeUndefined();
    expect([...result.bytes]).toEqual([...FULL]);
  });

  test("resumes from offset via Range + If-Range and appends a 206 body", async () => {
    const prefix = FULL.slice(0, 4); // bytes already on hand
    const remainder = FULL.slice(4); // what the server should send back
    const calls = stubFetch(
      () =>
        new Response(remainder, {
          status: 206,
          headers: { "content-range": "bytes 4-9/10", "content-length": "6" },
        })
    );

    const [result] = await runResumableDownload([
      { name: "a", url: "https://x/a", etag: '"v1"', total: 10, blob: new Blob([prefix]) },
    ]);

    expect(calls[0].headers.Range).toBe("bytes=4-");
    expect(calls[0].headers["If-Range"]).toBe('"v1"');
    expect([...result.bytes]).toEqual([...FULL]);
  });

  test("a changed file (200 to a Range request) discards the stale prefix", async () => {
    // Partial prefix (4 of 10) → the engine sends a Range request; the server
    // answers 200 with a whole, different file → the stale prefix is dropped.
    const stalePrefix = new Uint8Array([99, 99, 99, 99]);
    const fresh = new Uint8Array([5, 6, 7, 8, 9, 10]);
    const calls = stubFetch(
      () => new Response(fresh, { status: 200, headers: { "content-length": "6" } })
    );

    const [result] = await runResumableDownload([
      { name: "a", url: "https://x/a", etag: '"old"', total: 10, blob: new Blob([stalePrefix]) },
    ]);

    expect(calls[0].headers.Range).toBe("bytes=4-");
    expect([...result.bytes]).toEqual([...fresh]);
  });

  test("an already-complete file is returned without any fetch", async () => {
    const calls = stubFetch(() => new Response(new Uint8Array(), { status: 200 }));

    const [result] = await runResumableDownload([
      { name: "a", url: "https://x/a", etag: '"v1"', total: 10, blob: new Blob([FULL]) },
    ]);

    expect(calls).toHaveLength(0);
    expect([...result.bytes]).toEqual([...FULL]);
  });

  test("flushes the completed bytes through the persistence hook", async () => {
    stubFetch(
      () => new Response(FULL, { status: 200, headers: { "content-length": "10" } })
    );
    const flushes: EngineFlush[] = [];

    await runResumableDownload(
      [{ name: "a", url: "https://x/a", etag: null, total: null, blob: new Blob([]) }],
      { onFlush: (file) => flushes.push(file) }
    );

    expect(flushes.length).toBeGreaterThan(0);
    const last = flushes[flushes.length - 1];
    expect(last.received).toBe(10);
    expect([...(await bytesOf(last.blob))]).toEqual([...FULL]);
  });
});
