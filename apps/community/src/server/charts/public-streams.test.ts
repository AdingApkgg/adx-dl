import { expect, test } from "bun:test";
import { createPublicStreamLimiter } from "./public-streams";
test("a full catalog page fits the asset pool without consuming either ZIP slot", async () => {
  const zip = createPublicStreamLimiter(),
    assets = createPublicStreamLimiter({ global: 128, perIp: 32 });
  const request = new Request("https://example.test"),
    open = async () => new Response(new ReadableStream());
  const page = [];
  for (let i = 0; i < 24; i++) page.push(await assets("same-ip", request, open));
  const first = await zip("same-ip", request, open),
    second = await zip("same-ip", request, open);
  await expect(zip("same-ip", request, open)).rejects.toMatchObject({ status: 429 });
  const preview = await assets("same-ip", request, open);
  await Promise.all([...page, first, second, preview].map((r) => r.body!.cancel()));
  const retry = await zip("same-ip", request, open);
  await retry.body!.cancel();
});

test("HEAD error bodies are canceled before the HTTP adapter suppresses them and never consume ZIP slots", async () => {
  const limit = createPublicStreamLimiter();
  let canceled = 0;
  for (let i = 0; i < 4; i++) {
    const response = await limit("same-ip", new Request("https://example.test", { method: "HEAD" }), async () =>
      new Response(new ReadableStream({ cancel() { canceled++; } }), { status: 503 }),
    );
    expect(response.status).toBe(503);
    expect(response.body).toBeNull();
  }
  expect(canceled).toBe(4);
  const response = await limit("same-ip", new Request("https://example.test"), async () => new Response("ready"));
  expect(await response.text()).toBe("ready");
});

for (const limits of [{ global: 16, perIp: 2 }, { global: 128, perIp: 32 }])
  test(`HEAD status/cache and cancellation failure leave the ${limits.perIp}-slot pool usable`, async () => {
    const limit = createPublicStreamLimiter(limits);
    const headers = { "cache-control": "private, no-store", etag: '"fixture"' };
    for (let i = 0; i < limits.perIp + 1; i++) {
      const response = await limit("ip", new Request("https://example.test", { method: "HEAD" }), async () =>
        new Response(new ReadableStream({ cancel() { return Promise.reject(new Error("cancel failure")); } }), { status: 503, headers }),
      );
      expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.body).toBeNull();
    }
    for (const status of [200, 304]) {
      const response = await limit("ip", new Request("https://example.test", { method: "HEAD" }), async () => new Response(null, { status, headers }));
      expect(response.status).toBe(status); expect(response.headers.get("etag")).toBe('"fixture"');
    }
    const error = await limit("ip", new Request("https://example.test"), async () => new Response("upstream unavailable", { status: 503, headers }));
    expect(error.status).toBe(503); expect(await error.text()).toBe("upstream unavailable");
  });
