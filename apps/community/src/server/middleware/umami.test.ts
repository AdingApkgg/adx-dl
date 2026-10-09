import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { createLogger } from "@/shared/log";

import { createApp } from "../app";
import { testAppDeps } from "../testing/app-deps";
import { throttledErrorLog } from "../throttled-log";
import { umamiProxy } from "./umami";

type Received = { method: string; path: string; headers: Record<string, string>; body: string };

let received: Received[] = [];

// 假的 Umami：记下收到的请求，统计脚本和上报各回一个固定的响应，顺带回几个不该被带给浏览器的头。
const upstream = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    received.push({
      method: req.method,
      path: url.pathname,
      headers: Object.fromEntries(req.headers),
      body: await req.text(),
    });
    const extra = { "set-cookie": "umami=1", "content-security-policy": "default-src umami", "x-upstream": "yes" };
    if (url.pathname === "/script.js") {
      return new Response("/* tracker */", {
        headers: { "content-type": "text/javascript", "cache-control": "public, max-age=86400, must-revalidate", ...extra },
      });
    }
    return Response.json({ cache: "token-1" }, { headers: extra });
  },
});

afterAll(() => {
  upstream.stop(true);
});

beforeEach(() => {
  received = [];
});

function appWith(umamiInternalUrl: string | null) {
  const { deps, logs } = testAppDeps({ umamiInternalUrl });
  return { app: createApp(deps), logs };
}

const upstreamUrl = () => upstream.url.href.replace(/\/$/, "");

describe("/_s/*：转发给 Umami", () => {
  test("没开统计（没设网站 ID）时一律 404，不连 Umami", async () => {
    const { app } = appWith(null);

    expect((await app.request("/_s/script.js")).status).toBe(404);
    expect((await app.request("/_s/api/send", { method: "POST", body: "{}" })).status).toBe(404);
    expect(received).toEqual([]);
  });

  test("统计脚本：带回内容、Content-Type 和 Cache-Control，上游的其他头不带", async () => {
    const { app } = appWith(upstreamUrl());

    const res = await app.request("/_s/script.js");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("/* tracker */");
    expect(res.headers.get("content-type")).toBe("text/javascript");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400, must-revalidate");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-upstream")).toBeNull();
    // CSP 是本站的，不是 Umami 的。
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(received.map(({ method, path }) => `${method} ${path}`)).toEqual(["GET /script.js"]);
  });

  test("上报：请求体原样转发，只带白名单里的头，访客 IP 放在 CF-Connecting-IP", async () => {
    const { app } = appWith(upstreamUrl());
    const body = JSON.stringify({ type: "event", payload: { website: "w", url: "/" } });

    const res = await app.request("/_s/api/send", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 test",
        "x-umami-cache": "token-0",
        "cf-connecting-ip": "203.0.113.7",
        "cf-ipcountry": "JP",
        cookie: "adxc.session_token=secret",
        authorization: "Bearer secret",
        "true-client-ip": "198.51.100.1",
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cache: "token-1" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(received).toHaveLength(1);
    const [forwarded] = received;
    expect(forwarded?.method).toBe("POST");
    expect(forwarded?.path).toBe("/api/send");
    expect(forwarded?.body).toBe(body);
    expect(forwarded?.headers).toMatchObject({
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 test",
      "x-umami-cache": "token-0",
      "cf-connecting-ip": "203.0.113.7",
      "cf-ipcountry": "JP",
    });
    for (const name of ["cookie", "authorization", "true-client-ip"]) {
      expect(forwarded?.headers).not.toHaveProperty(name);
    }
  });

  // Umami 的登录、管理接口不能经主站的域名暴露：管理后台在单独的域名，放在 Cloudflare Access 后面。
  test("只转发统计脚本和上报两个地址，其余的 /_s/* 都是 404", async () => {
    const { app } = appWith(upstreamUrl());

    for (const [method, path] of [
      ["POST", "/_s/api/auth/login"],
      ["GET", "/_s/api/websites"],
      ["GET", "/_s/"],
      ["POST", "/_s/script.js"],
      ["GET", "/_s/api/send"],
    ] as const) {
      const res = await app.request(path, { method, body: method === "POST" ? "{}" : undefined });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(received).toEqual([]);
  });

  test("上报的请求体超过 64 KiB：413，不转发", async () => {
    const { app } = appWith(upstreamUrl());

    const res = await app.request("/_s/api/send", {
      method: "POST",
      body: "x".repeat(65 * 1024),
      headers: { "content-type": "application/json", "content-length": String(65 * 1024) },
    });

    expect(res.status).toBe(413);
    expect(received).toEqual([]);
  });

  test("Umami 连不上：502，错误日志一分钟最多一条", async () => {
    const { app, logs } = appWith("http://127.0.0.1:9");

    expect((await app.request("/_s/script.js")).status).toBe(502);
    expect((await app.request("/_s/api/send", { method: "POST", body: "{}" })).status).toBe(502);

    expect(logs().filter((entry) => entry.event === "umami_forward_failed")).toHaveLength(1);
  });
});

describe("Umami 的响应体传输失败", () => {
  for (const [method, path] of [
    ["GET", "/script.js"],
    ["POST", "/api/send"],
  ] as const) {
    for (const failure of ["timeout", "reset"] as const) {
      test(`${method} ${path}: ${failure} 返回 502，重复错误走限频日志`, async () => {
        const lines: string[] = [];
        const unhandled: unknown[] = [];
        const app = umamiProxy({
          internalUrl: "http://umami.test",
          timeoutMs: 20,
          onError: throttledErrorLog(createLogger((line) => lines.push(line)), "umami_forward_failed"),
          fetch: async (_url, init) =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode("partial"));
                  if (failure === "reset") {
                    controller.error(new Error("upstream connection reset"));
                  } else {
                    init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
                  }
                },
              })
            ),
        });
        app.onError((error, c) => {
          unhandled.push(error);
          return c.json({ error: "unhandled" }, 500);
        });

        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await app.request(path, { method, body: method === "POST" ? "{}" : undefined });
          expect(res.status).toBe(502);
          expect(await res.json()).toEqual({
            error: { code: "UPSTREAM_UNAVAILABLE", message: "Analytics is unavailable" },
          });
        }
        expect(unhandled).toEqual([]);
        expect(lines.map((line) => JSON.parse(line).event)).toEqual(["umami_forward_failed"]);
      });
    }
  }
});
