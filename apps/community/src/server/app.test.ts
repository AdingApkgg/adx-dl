import { describe, expect, test } from "bun:test";

import { createApp } from "./app";

describe("createApp", () => {
  test("/healthz 返回 ok", async () => {
    const res = await createApp().request("/healthz");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
