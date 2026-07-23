import { describe, expect, test } from "bun:test";

import {
  probeCustomDownloadSource,
  probeDownloadSource,
} from "@/lib/download-source-probe";

describe("download source latency probe", () => {
  test("measures a successful HEAD request in milliseconds", async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const times = [100, 142.4];
    const result = await probeDownloadSource("alice", {
      now: () => times.shift() ?? 142.4,
      fetcher: (async (input, init) => {
        calls.push({ input: String(input), init });
        return new Response(null, { status: 200 });
      }) as typeof fetch,
    });

    expect(result).toEqual({ state: "ok", latencyMs: 42 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      input: "https://astrodx-charts-alice.saop.cc/0/10/track.mp3",
      init: { method: "HEAD", mode: "cors", cache: "no-store" },
    });
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("marks non-success and network responses unavailable", async () => {
    const notFound = await probeDownloadSource("alice", {
      fetcher: (async () => new Response(null, { status: 404 })) as typeof fetch,
    });
    const networkError = await probeDownloadSource("g510", {
      fetcher: (async () => {
        throw new TypeError("network failed");
      }) as typeof fetch,
    });

    expect(notFound).toEqual({ state: "error", latencyMs: null });
    expect(networkError).toEqual({ state: "error", latencyMs: null });
  });

  test("probes a normalized custom route without falling back to R2", async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const times = [10, 47.7];
    const result = await probeCustomDownloadSource(
      " https://mirror.example.com/charts/ ",
      {
        now: () => times.shift() ?? 47.7,
        fetcher: (async (input, init) => {
          calls.push({ input: String(input), init });
          return new Response(null, { status: 204 });
        }) as typeof fetch,
      }
    );

    expect(result).toEqual({ state: "ok", latencyMs: 38 });
    expect(calls[0]).toMatchObject({
      input: "https://mirror.example.com/charts/0/10/track.mp3",
      init: { method: "HEAD", mode: "cors", cache: "no-store" },
    });
  });

  test("aborts a probe that exceeds its timeout", async () => {
    const result = await probeDownloadSource("g400s", {
      timeoutMs: 1,
      fetcher: ((_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        })) as typeof fetch,
    });

    expect(result).toEqual({ state: "timeout", latencyMs: null });
  });
});
