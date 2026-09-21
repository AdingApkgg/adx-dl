import { describe, expect, test } from "bun:test";

import { createApp } from "./app";

describe("createApp", () => {
  test("GET /api/ping 返回 ok", async () => {
    const app = createApp({ clientRoot: "./build/client" });

    const res = await app.request("/api/ping");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("未知的 /api 路径返回 404 而不是 SPA 的 index.html", async () => {
    const app = createApp({ clientRoot: "./build/client" });

    const res = await app.request("/api/does-not-exist");

    expect(res.status).toBe(404);
  });
});
