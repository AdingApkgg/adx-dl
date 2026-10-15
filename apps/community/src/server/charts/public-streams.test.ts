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
