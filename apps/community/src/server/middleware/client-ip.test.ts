import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { AppEnv } from "../app-env";
import { clientIp } from "./client-ip";

function probe() {
  return new Hono<AppEnv>().use("*", clientIp()).get("/", (c) => c.text(c.get("clientIp")));
}

describe("clientIp", () => {
  test("优先用 Cloudflare 给的 CF-Connecting-IP", async () => {
    const res = await probe().request("/", { headers: { "cf-connecting-ip": " 203.0.113.7 " } });
    expect(await res.text()).toBe("203.0.113.7");
  });

  // app.request() 这类进程内调用没有真实连接，拿不到对端地址，不能因此报错。
  test("没有这个头、也拿不到连接信息时是 unknown", async () => {
    const res = await probe().request("/");
    expect(await res.text()).toBe("unknown");
  });
});
