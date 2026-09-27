import { describe, expect, test } from "bun:test";

import { createApp } from "./app";
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
});
