import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { type RunningServer, startBuiltServer } from "./server";

const WEBSITE_ID = "11111111-2222-4333-8444-555555555555";

type Received = { method: string; path: string; headers: Record<string, string>; body: string };
const received: Received[] = [];

// 假的 Umami。构建产物经 UMAMI_INTERNAL_URL 连它，和线上经容器网络连 umami:3000 一样。
const upstream = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    received.push({ method: req.method, path: url.pathname, headers: Object.fromEntries(req.headers), body: await req.text() });
    if (url.pathname === "/script.js") {
      return new Response("/* tracker */", { headers: { "content-type": "text/javascript" } });
    }
    return Response.json({ cache: "token-1" });
  },
});

let server: RunningServer;

beforeAll(async () => {
  server = await startBuiltServer({
    UMAMI_WEBSITE_ID: WEBSITE_ID,
    UMAMI_INTERNAL_URL: upstream.url.href,
  });
}, 60_000);

afterAll(async () => {
  await server.stop();
  upstream.stop(true);
});

// spec 第 16 节"data-host-url 的行为"：tracker 把上报发到 data-host-url 加 /api/send（Umami v3.4.0 的
// src/tracker/index.ts），所以页面上写 /_s，上报就是 /_s/api/send，由 Hono 转发。
describe("开了统计的构建产物", () => {
  test("页面 <head> 里有统计脚本：网站 ID、/_s、只记本站域名、不记查询串和 # 后面", async () => {
    const html = await (await fetch(server.url("/en/"))).text();
    const tag = /<script[^>]*src="\/_s\/script\.js"[^>]*><\/script>/.exec(html)?.[0] ?? "";

    expect(tag).toContain(`data-website-id="${WEBSITE_ID}"`);
    expect(tag).toContain('data-host-url="/_s"');
    expect(tag).toContain('data-domains="127.0.0.1"');
    expect(tag).toContain('data-exclude-search="true"');
    expect(tag).toContain('data-exclude-hash="true"');
    expect(tag).toContain("defer");
    expect(html.indexOf(tag)).toBeLessThan(html.indexOf("</head>"));
  });

  test("脚本和上报都经 /_s 转发到 Umami；访客 IP 交给 Umami，会话 Cookie 不交", async () => {
    const script = await fetch(server.url("/_s/script.js"));
    expect(script.status).toBe(200);
    expect(await script.text()).toBe("/* tracker */");

    const body = JSON.stringify({ type: "event", payload: { website: WEBSITE_ID, url: "/", name: "login" } });
    const sent = await fetch(server.url("/_s/api/send"), {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 test",
        "cf-connecting-ip": "203.0.113.7",
        cookie: "adxc.session_token=x",
      },
    });
    expect(sent.status).toBe(200);
    expect(await sent.json()).toEqual({ cache: "token-1" });
    expect(sent.headers.get("set-cookie")).toBeNull();

    const report = received.find((entry) => entry.path === "/api/send");
    expect(report?.body).toBe(body);
    expect(report?.headers["cf-connecting-ip"]).toBe("203.0.113.7");
    expect(report?.headers).not.toHaveProperty("cookie");
  });

  test("Umami 的其他接口不经主站暴露", async () => {
    const res = await fetch(server.url("/_s/api/auth/login"), { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
    expect(received.some((entry) => entry.path === "/api/auth/login")).toBe(false);
  });
});
