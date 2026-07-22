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
});
