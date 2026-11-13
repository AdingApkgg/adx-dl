import { describe, expect, test } from "bun:test";

import { probeCommentServer, watchCommentLoading } from "./comment-loading";

function harness(timeoutMs = 100) {
  const handlers = new Map<string, () => void>();
  const results: string[] = [];
  const cancel = watchCommentLoading(
    { on: (event, handler) => handlers.set(event, handler), off: (event) => handlers.delete(event) },
    (status) => results.push(status),
    timeoutMs,
  );
  return { emit: (event: string) => handlers.get(event)?.(), results, cancel, handlers };
}

describe("initial comment loading", () => {
  test("mounting alone is not a successful comment request", () => {
    const run = harness();
    run.emit("mounted");
    expect(run.results).toEqual([]);
    run.emit("list-loaded");
    expect(run.results).toEqual(["ready"]);
    expect(run.handlers.size).toBe(0);
    run.cancel();
  });

  test("a failed initial request becomes retryable", () => {
    const run = harness();
    run.emit("list-failed");
    run.emit("list-loaded");
    expect(run.results).toEqual(["error"]);
  });

  test("configuration/plugin initialization that never completes times out", async () => {
    const run = harness(5);
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(run.results).toEqual(["error"]);
  });

  test("unmount cancels pending callbacks", async () => {
    const run = harness(5);
    run.cancel();
    run.emit("list-loaded");
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(run.results).toEqual([]);
    expect(run.handlers.size).toBe(0);
  });

  test("later list failures stay with Artalk and preserve a typed draft", async () => {
    const run = harness(5);
    run.emit("list-loaded");
    run.emit("list-failed");
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(run.results).toEqual(["ready"]);
  });
});

describe("comment server configuration preflight", () => {
  test("a successful public configuration check does not submit comments", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    globalThis.fetch = async (input: RequestInfo | URL, options?: RequestInit) => {
      calls.push([input, options]);
      return new Response("{}");
    };
    try {
      await probeCommentServer("https://comments.example", new AbortController().signal);
      expect(calls[0]?.[0]).toBe("https://comments.example/api/v2/conf");
      expect(calls[0]?.[1]?.method).toBe("GET");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a CORS/network rejection is propagated before Artalk initialization", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    try {
      await expect(probeCommentServer("https://comments.example", new AbortController().signal)).rejects.toThrow("Failed to fetch");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a stalled public configuration request is aborted", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (_url: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    try {
      await expect(probeCommentServer("https://comments.example", new AbortController().signal, 5)).rejects.toThrow("aborted");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
