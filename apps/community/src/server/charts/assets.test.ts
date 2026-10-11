import { expect, test } from "bun:test";
import type { StorageContext, ObjectDriver } from "../storage/contracts";
import { createApp } from "../app";
import { testAppDeps } from "../testing/app-deps";
import { chartAssetResponse, type ChartAssetRepresentation } from "./assets";

const asset: ChartAssetRepresentation = { key: "sha256/fixture", artifactSize: 100, artifactSha256: "a".repeat(64),
  artifactMime: "application/vnd.astrodx.chart-preview", start: 40, size: 10, mime: "audio/ogg", sha256: "b".repeat(64) };
function fake(overrides: Partial<ObjectDriver> = {}) {
  const calls: { start: number; end: number }[] = [];
  const driver = {
    head: async () => ({ size: 100, mime: asset.artifactMime, sha256: asset.artifactSha256 }),
    get: async (input: { range?: { start: number; end: number } }) => {
      calls.push(input.range!);
      const bytes = new Uint8Array(input.range!.end - input.range!.start + 1).fill(7);
      return { size: bytes.length, mime: asset.artifactMime, sha256: asset.artifactSha256,
        body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }) };
    }, ...overrides,
  } as ObjectDriver;
  return { ctx: { driver } as StorageContext, calls };
}
test("asset ranges and HEAD use asset headers while reading only the mapped whole-object segment", async () => {
  const f = fake();
  const request = new Request("https://example.test/asset", { headers: { range: "bytes=2-5" } });
  const response = await chartAssetResponse(f.ctx, asset, request);
  expect(response.status).toBe(206);
  expect(response.headers.get("content-type")).toBe("audio/ogg");
  expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
  expect(response.headers.get("content-length")).toBe("4");
  expect(response.headers.get("etag")).toBe(`"sha256-${asset.sha256}"`);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(4).fill(7));
  expect(f.calls).toEqual([{ start: 42, end: 45 }]);
  const head = await chartAssetResponse(f.ctx, asset, new Request("https://example.test/asset", { method: "HEAD", headers: { range: "bytes=-3" } }));
  expect(head.status).toBe(206);
  expect(head.headers.get("content-range")).toBe("bytes 7-9/10");
  expect(await head.text()).toBe("");
  expect(f.calls).toHaveLength(1);
});
test("invalid ranges remain private and validators cannot bypass a missing/corrupt whole artifact", async () => {
  const f = fake();
  const bad = await chartAssetResponse(f.ctx, asset, new Request("https://example.test/asset", { headers: { range: "bytes=0-1,3-4" } }));
  expect(bad.status).toBe(416);
  expect(bad.headers.get("content-range")).toBe("bytes */10");
  expect(bad.headers.get("cache-control")).toBe("private, no-store");
  expect(bad.headers.get("x-content-type-options")).toBe("nosniff");
  expect(f.calls).toHaveLength(0);
  const missing = fake({ head: async () => null });
  expect((await chartAssetResponse(missing.ctx, asset, new Request("https://example.test/asset", { method: "HEAD", headers: { "if-none-match": "*" } }))).status).toBe(503);
  const valid = await chartAssetResponse(f.ctx, asset, new Request("https://example.test/asset", { headers: { "if-none-match": `"sha256-${asset.sha256}"` } }));
  expect(valid.status).toBe(304); expect(f.calls).toHaveLength(0);
});
test("canceling the private asset response cancels its storage stream", async () => {
  let canceled = false;
  const f = fake({ get: async () => ({ size: 10, mime: asset.artifactMime, sha256: asset.artifactSha256,
    body: new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array([1])); }, cancel() { canceled = true; } }) }) });
  const response = await chartAssetResponse(f.ctx, asset, new Request("https://example.test/asset"));
  await response.body!.cancel();
  expect(canceled).toBe(true);
});
test("anonymous asset requests fail authentication before storage and retain private error headers", async () => {
  const { deps } = testAppDeps();
  const app = createApp(deps);
  for (const method of ["GET", "HEAD"]) {
    const response = await app.request(`/api/v1/me/charts/${crypto.randomUUID()}/versions/${crypto.randomUUID()}/assets/maidata`, { method });
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    if (method === "HEAD") expect(await response.text()).toBe("");
  }
});
