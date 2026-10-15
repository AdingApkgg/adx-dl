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
