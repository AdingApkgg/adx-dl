import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { AppEnv } from "../app-env";
import { clientIp, rateLimitKeyForIp } from "./client-ip";

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

describe("rateLimitKeyForIp", () => {
  test("IPv4 原样返回", () => {
    expect(rateLimitKeyForIp("203.0.113.7")).toBe("203.0.113.7");
  });

  // 运营商通常给一户分一整个 /64，只按完整地址计数，换个地址就绕过去了（1a 评审遗留 #8）。
  test("IPv6 按 /64 合并，写法不同的同一个地址得到同一个键", () => {
    expect(rateLimitKeyForIp("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3:8d3::/64");
    expect(rateLimitKeyForIp("2001:0DB8:85A3:08D3::1")).toBe("2001:db8:85a3:8d3::/64");
    expect(rateLimitKeyForIp("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitKeyForIp("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  test("IPv4 映射地址按 IPv4 算", () => {
    expect(rateLimitKeyForIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  test("认不出的原样返回", () => {
    for (const value of ["unknown", "2001:db8::1::2", "2001:db8:zz::1"]) {
      expect(rateLimitKeyForIp(value)).toBe(value);
    }
  });
});
