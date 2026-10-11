import { themeBootScript } from "@astrodx/ui/theme";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { type RunningServer, startBuiltServer } from "./server";

let server: RunningServer;

beforeAll(async () => {
  server = await startBuiltServer();
}, 30_000);

afterAll(async () => {
  await server.stop();
});

describe("页面", () => {
  test("隐私说明无需登录，三种语言有正文、联系邮箱与 canonical", async () => {
    for (const [path, lang, title] of [
      ["/privacy", "zh-CN", "隐私说明"],
      ["/en/privacy", "en", "Privacy notice"],
      ["/ja/privacy", "ja", "プライバシーについて"],
    ]) {
      const res = await fetch(server.url(path ?? ""), { redirect: "manual" });
      const html = await res.text();
      expect(res.status, path).toBe(200);
      expect(html).toContain(`<html lang="${lang}"`);
      expect(html).toContain(title ?? "");
      expect(html).toContain('href="mailto:privacy@example.test"');
      expect(html).toContain(`<link rel="canonical" href="${server.origin}${path}"/>`);
      expect(html).toContain("Google");
      expect(html).toContain("3550411407");
      expect(html).not.toContain("GOCSPX-");
    }
  });

  test("首页和登录页都提供当前语言的隐私入口", async () => {
    for (const prefix of ["", "/en", "/ja"]) {
      for (const suffix of ["/", "/login"]) {
        const html = await (await fetch(server.url(`${prefix}${suffix}`))).text();
        expect(html).toContain(`href="${prefix}/privacy"`);
      }
    }
  });

  test("首页：中文，200，不缓存", async () => {
    const res = await fetch(server.url("/"));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.text()).toContain('<html lang="zh-CN"');
  });

  // 网站 ID 要等 Umami 后台建好网站才有。没设的时候页面里没有统计脚本，/_s/* 是 404，站点照常运行。
  test("没开统计：页面里没有统计脚本，/_s/script.js 是 404", async () => {
    const html = await (await fetch(server.url("/"))).text();

    expect(html).not.toContain("/_s/script.js");
    expect((await fetch(server.url("/_s/script.js"))).status).toBe(404);
  });

  // 漏掉 nonce 的内联脚本会被 CSP 拦下，页面在生产环境就 hydrate 不起来，而开发环境
  // 只报告不拦截，看不出来。
  test("每个内联脚本都带着本次响应 CSP 里的 nonce", async () => {
    const res = await fetch(server.url("/"));
    const html = await res.text();
    const nonce = /'nonce-([^']+)'/.exec(res.headers.get("content-security-policy") ?? "")?.[1];
    const inlineScripts = (html.match(/<script\b[^>]*>/g) ?? []).filter((tag) => !/\ssrc=/.test(tag));

    expect(nonce).toBeTruthy();
    expect(inlineScripts.length).toBeGreaterThan(0);
    for (const tag of inlineScripts) {
      expect(tag).toContain(`nonce="${nonce}"`);
    }
  });

  // spec 第 10 节（0b）：防闪烁脚本内联在 <head> 里，nonce 就是这次响应 CSP 里的那个。对不上的话，生产环境里它会被
  // CSP 拦下，刷新时页面先按默认的深色画一帧再变。
  test("防闪烁脚本在 <head> 里，nonce 和响应头 CSP 里的一致", async () => {
    const res = await fetch(server.url("/"));
    const html = await res.text();
    const nonce = /'nonce-([^']+)'/.exec(res.headers.get("content-security-policy") ?? "")?.[1];
    const headEnd = html.indexOf("</head>");
    const head = html.slice(0, headEnd);

    expect(nonce).toBeTruthy();
    // 没有 </head> 的话 head 是整页去掉最后一个字符，下面几条会白白通过。
    expect(headEnd).toBeGreaterThan(0);
    expect(head).toContain(`<script id="theme-init" nonce="${nonce}">${themeBootScript()}</script>`);
    // 在样式表之前：样式表还没加载完，主题就已经定好了。
    expect(head.indexOf('rel="stylesheet"')).toBeGreaterThan(head.indexOf('id="theme-init"'));
  });

  // 样式表的 nonce 是空的：React Router 会把请求的 nonce 抄到 <link> 上，浏览器里读不到这个值，hydrate 时报属性对不上。
  // CSP 的 style-src 不用 nonce，空值没有影响。
  test("样式表的 <link> 带空的 nonce，不是 CSP 里的那个", async () => {
    const res = await fetch(server.url("/"));
    const html = await res.text();
    const nonce = /'nonce-([^']+)'/.exec(res.headers.get("content-security-policy") ?? "")?.[1];
    const stylesheets = html.match(/<link\b[^>]*\brel="stylesheet"[^>]*>/g) ?? [];

    expect(nonce).toBeTruthy();
    expect(stylesheets.length).toBeGreaterThan(0);
    for (const tag of stylesheets) {
      expect(tag).toContain('nonce=""');
      expect(tag).not.toContain(`nonce="${nonce}"`);
    }
  });

  test("首页经由进程内 API 拿到了数据", async () => {
    expect(await (await fetch(server.url("/"))).text()).toContain("接口版本 v1");
  });

  // 首页的 loader 经进程内 API 问了当前用户（没登录是 401），页面据此显示"登录"链接。
  test("首页：未登录显示登录链接，登录后回到首页", async () => {
    const html = await (await fetch(server.url("/"))).text();

    expect(html).toContain('href="/login?next=%2F"');
    expect(html).not.toContain('href="/settings/account"');
  });

  // 文案对了，说明 Paraglide 的中间件把语言带进了服务端渲染。
  test("英文和日文前缀：服务端用对应的语言渲染", async () => {
    const en = await (await fetch(server.url("/en"))).text();
    const ja = await (await fetch(server.url("/ja/"))).text();

    expect(en).toContain('<html lang="en"');
    expect(en).toContain("AstroDX Community");
    expect(en).toContain("API v1");
    expect(ja).toContain('<html lang="ja"');
    expect(ja).toContain("AstroDX コミュニティ");
  });

  test("/zh 前缀 301 到不带前缀的地址，不缓存", async () => {
    const res = await fetch(server.url("/zh/foo?x=1"), { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/foo?x=1");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("/robots.txt 是纯文本，不是 404 页", async () => {
    const res = await fetch(server.url("/robots.txt"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Disallow: /api/");
  });

  // Cloudflare 原样转发路径，//evil.com 这样的 Location 会把访客带到别的站。
  test("/zh//evil.com 仍然跳回本站", async () => {
    const res = await fetch(server.url("/zh//evil.com"), { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/evil.com");
  });

  test("未知地址返回真正的 404，也不缓存", async () => {
    const res = await fetch(server.url("/definitely-missing"));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const html = await res.text();
    expect(html).toContain("页面不存在");
    // 一段的地址由 :lang? 布局的中间件判成 404，落到根组件的错误边界：那里只有出错卡片，没有页头。
    expect(html).not.toContain("<header");
  });

  test("英文下的未知地址也是 404，用英文显示", async () => {
    const res = await fetch(server.url("/en/definitely-missing"));
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Page not found");
    // 两段的地址由 :lang? 布局的错误边界接住（spec 第 7.4 节）：页头照样在。
    expect(html).toContain("<header");
  });

  test("大小写不对的语言前缀也是 404", async () => {
    expect((await fetch(server.url("/EN"))).status).toBe(404);
  });

  test("构建产物带 immutable", async () => {
    const html = await (await fetch(server.url("/"))).text();
    const asset = /\/assets\/[^"']+\.js/.exec(html)?.[0];

    expect(asset).toBeTruthy();
    const res = await fetch(server.url(asset ?? ""));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  test("Permissions-Policy 没有禁用通行密钥", async () => {
    const policy = (await fetch(server.url("/"))).headers.get("permissions-policy") ?? "";
    expect(policy).toContain("camera=()");
    expect(policy).not.toContain("publickey-credentials");
  });
});

describe("接口和健康检查", () => {
  test("GET /api/v1/meta", async () => {
    const res = await fetch(server.url("/api/v1/meta"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "astrodx-community", apiVersion: 1 });
  });

  test("未知接口返回 JSON 404", async () => {
    const res = await fetch(server.url("/api/v1/nope"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
  });

  test("表单提交被 CSRF 规则拒绝", async () => {
    const res = await fetch(server.url("/api/v1/meta"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: server.origin },
      body: "a=1",
    });
    expect(res.status).toBe(415);
  });

  test("/readyz：缺少实际媒体进程时保持未就绪", async () => {
    const res = await fetch(server.url("/readyz"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, checks: { db: "ok", redis: "ok", jobs: "ok",media:"fail" } });
  });

  test("/readyz 不回答经 Cloudflare 来的请求", async () => {
    const res = await fetch(server.url("/readyz"), { headers: { "cf-connecting-ip": "203.0.113.7" } });
    expect(res.status).toBe(404);
  });
});
