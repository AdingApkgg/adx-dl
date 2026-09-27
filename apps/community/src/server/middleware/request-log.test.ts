import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { requestId } from "hono/request-id";

import type { AppEnv } from "../app-env";
import { createLogger } from "../log";
import { clientIp } from "./client-ip";
import { requestLog } from "./request-log";

describe("requestLog", () => {
  test("记录方法、路径、状态码、耗时和请求 ID，不记查询串", async () => {
    const lines: string[] = [];
    const app = new Hono<AppEnv>()
      .use("*", requestId())
      .use("*", clientIp())
      .use("*", requestLog(createLogger((line) => lines.push(line))))
      .get("/healthz", (c) => c.text("ok"));

    const res = await app.request("/healthz?token=super-secret", {
      headers: { "cf-connecting-ip": "203.0.113.7" },
    });

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? "{}");
    expect(entry).toMatchObject({
      event: "request",
      method: "GET",
      path: "/healthz",
      status: 200,
      ip: "203.0.113.7",
      requestId: res.headers.get("x-request-id"),
    });
    expect(typeof entry.ms).toBe("number");
    expect(lines[0]).not.toContain("super-secret");
  });
});
