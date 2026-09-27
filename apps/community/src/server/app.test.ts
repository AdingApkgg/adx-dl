import { describe, expect, test } from "bun:test";

import { createApp } from "./app";
import { createMemoryRateLimitStore } from "./middleware/rate-limit";
import { testAppDeps } from "./testing/app-deps";

describe("createApp", () => {
  test("/healthz 返回 ok，并带上请求 ID", async () => {
    const res = await createApp(testAppDeps().deps).request("/healthz");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  test("未知的 /api 路径返回 JSON 404，不落到页面渲染", async () => {
    const res = await createApp(testAppDeps().deps).request("/api/nope");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
  });

  // 子项目 2 实现；这里先占住位置，保证它挂在以后的会话中间件之前。
  // 响应里一旦带 Set-Cookie，Cloudflare 就不会缓存它（spec 第 8.1 节第 4 条）。
  test("/media 目前返回 404，并且不带 Set-Cookie", async () => {
    const res = await createApp(testAppDeps().deps).request("/media/abc.jpg");
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("未处理的异常返回通用 500，细节只进日志", async () => {
    const { deps, logs } = testAppDeps();
    const app = createApp(deps);
    app.get("/test-boom", () => {
      throw new Error("db password is hunter2");
    });

    const res = await app.request("/test-boom");

    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain("INTERNAL");
    expect(body).not.toContain("hunter2");
    expect(logs().find((entry) => entry.event === "unhandled_error")).toMatchObject({
      path: "/test-boom",
      message: "db password is hunter2",
    });
  });

  test("安全响应头已经挂上", async () => {
    const res = await createApp(testAppDeps().deps).request("/healthz");
    expect(res.headers.get("content-security-policy")).toContain("'nonce-");
  });

  test("/readyz 在所有检查通过时返回 200", async () => {
    const { deps } = testAppDeps({ checks: { db: async () => {}, redis: async () => {} } });
    const res = await createApp(deps).request("/readyz");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checks: { db: "ok", redis: "ok" } });
  });

  test("/readyz 有一项失败时返回 503，原因写进日志", async () => {
    const { deps, logs } = testAppDeps({
      checks: {
        db: async () => {},
        redis: async () => {
          throw new Error("connection refused");
        },
      },
    });
    const res = await createApp(deps).request("/readyz");

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, checks: { db: "ok", redis: "fail" } });
    expect(logs().find((entry) => entry.event === "readiness_check_failed")).toMatchObject({
      check: "redis",
      message: "connection refused",
    });
  });

  test("/api 按 IP 限流，每分钟 300 次", async () => {
    const { deps } = testAppDeps({ rateLimitStore: createMemoryRateLimitStore() });
    const app = createApp(deps);
    const headers = { "cf-connecting-ip": "198.51.100.1" };

    for (let i = 0; i < 300; i++) {
      expect((await app.request("/api/anything", { headers })).status).toBe(404);
    }
    expect((await app.request("/api/anything", { headers })).status).toBe(429);
    // 别的 IP 不受影响；页面和健康检查不走这条规则。
    expect((await app.request("/api/anything", { headers: { "cf-connecting-ip": "198.51.100.2" } })).status).toBe(404);
    expect((await app.request("/healthz", { headers })).status).toBe(200);
  });

  test("GET /api/v1/meta", async () => {
    const res = await createApp(testAppDeps().deps).request("/api/v1/meta");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "astrodx-community", apiVersion: 1 });
  });

  test("/api/v1 的写请求要过 CSRF 检查", async () => {
    const res = await createApp(testAppDeps().deps).request("/api/v1/meta", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "a=1",
    });
    expect(res.status).toBe(415);
  });
});
