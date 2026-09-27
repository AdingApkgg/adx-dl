import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { expectOk } from "@/shared/api-client";

import { createApp } from "./app";
import { createInProcessApi } from "./in-process-api";
import { testAppDeps } from "./testing/app-deps";

const ORIGIN = "https://community.test";
const META = { origin: ORIGIN, requestId: "req-1", clientIp: "203.0.113.7" };

describe("createInProcessApi", () => {
  test("在进程内调用自己的 /api/v1，不走网络", async () => {
    const app = createApp(testAppDeps().deps);
    const api = createInProcessApi(app, new Request(`${ORIGIN}/`), META);

    const meta = await (await expectOk(await api.api.v1.meta.$get())).json();

    expect(meta).toEqual({ name: "astrodx-community", apiVersion: 1 });
  });

  // 带上 Cookie，接口才认得出是同一个登录用户；沿用请求 ID，两条日志才串得起来；
  // 带上访客 IP，限流才算到这个人头上。
  test("沿用本次请求的 ID 和访客 IP，转发 Cookie，不转发别的头", async () => {
    const echo = new Hono().get("/api/v1/meta", (c) =>
      c.json({
        cookie: c.req.header("cookie") ?? null,
        requestId: c.req.header("x-request-id") ?? null,
        ip: c.req.header("cf-connecting-ip") ?? null,
        other: c.req.header("x-custom") ?? null,
      })
    );
    // 访客自己带来的 X-Request-Id 要被换成本次请求真正用的那个。
    const incoming = new Request(`${ORIGIN}/`, {
      headers: { cookie: "session=abc", "x-request-id": "from-visitor", "x-custom": "no" },
    });
    const api = createInProcessApi(echo, incoming, META);

    const body = (await (await api.api.v1.meta.$get()).json()) as unknown;

    expect(body).toEqual({ cookie: "session=abc", requestId: "req-1", ip: "203.0.113.7", other: null });
  });
});
