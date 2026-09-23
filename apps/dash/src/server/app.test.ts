import { beforeAll, describe, expect, test } from "bun:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

import { createApp, type AppDeps } from "./app";
import { GitHubRequestError } from "./github/client";
import { createFakeGitHubClient } from "./github/fake-client";

const TEAM = "https://example.cloudflareaccess.com";
const AUD = "aud-tag-abc";
const PUBLIC_ORIGIN = "https://dash.example.com";

// 这个文件不测 JWT 校验边界本身——aud/issuer/algorithm/签名这些逐条
// 覆盖在 access-jwt.test.ts 里。这里的每一条用例只需要「一个能通过
// accessJwt 中间件的合法断言」，好把请求送到后面的路由匹配/csrf/错误
// 处理逻辑上去；没有任何一条用例要求这把密钥和别的用例不一样，或者
// 依赖它是新生成的。原先 12 条测试各自调用 makeAccess()，每条都重新
// generateKeyPair 一遍——这是这个文件里唯一慢的操作（真实 CPU 时间），
// 12 遍纯粹是在反复证明同一件事，也是这个文件跑起来慢、在 CPU 紧张时
// 容易撞上默认 5s 超时的直接原因。这里只生成一次，所有测试共享。
//
// 放在 beforeAll 而不是模块顶层 await，原因与 access-jwt.test.ts 里
// 同样的取舍一致：generateKeyPair 一旦抛错，beforeAll 会被测试框架
// 当成「这个文件的 setup hook 失败」清楚地报出来，只影响这一个文件；
// 模块顶层 await 抛错则是一次更笼统的 import 失败。
//
// 声明在所有 describe(...) 之外：这个文件有三个并列的 describe 块
// （createApp / Finding I-2 / Finding I-5），全都要用同一把共享密钥，
// 所以 hook 要挂在文件顶层，而不是嵌进某一个 describe 里只对它生效。
let sharedAccess: { config: AppDeps["accessConfig"]; assertion: string };

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";

  const assertion = await new SignJWT({ email: "someone@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuedAt()
    .setSubject("user-1")
    .setIssuer(TEAM)
    .setAudience(AUD)
    .setExpirationTime("1h")
    .sign(privateKey);

  sharedAccess = {
    config: { teamDomain: TEAM, aud: AUD, getKey: createLocalJWKSet({ keys: [jwk] }) },
    assertion,
  };
});

// 不带定时器的最小假货：这些测试只关心路由挂没挂上，不关心推送。
const stubPoller = { subscribe: () => () => {}, snapshot: () => [] };

function makeApp(overrides: Partial<AppDeps> = {}) {
  const deps: AppDeps = {
    clientRoot: "./build/client",
    github: createFakeGitHubClient(),
    accessConfig: sharedAccess.config,
    poller: stubPoller,
    dashPublicOrigin: PUBLIC_ORIGIN,
    ...overrides,
  };
  return { app: createApp(deps), assertion: sharedAccess.assertion };
}

describe("createApp", () => {
  test("GET /api/ping 不需要鉴权就能通", async () => {
    // 健康检查在 Access 中间件之前：docker 的 healthcheck 拿不到断言，
    // 而它要回答的只是「进程还活着吗」。
    const { app } = await makeApp();

    const res = await app.request("/api/ping");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("没有 Access 断言时，受保护路径 403", async () => {
    const { app } = await makeApp();

    const res = await app.request("/api/me");

    expect(res.status).toBe(403);
  });

  test("未鉴权时连「路径存不存在」都不该泄漏", async () => {
    // 这里是 403 而不是 404：中间件在路由之前，没通过鉴权的请求不该
    // 能靠状态码探出哪些端点存在。
    const { app } = await makeApp();

    const res = await app.request("/api/does-not-exist");

    expect(res.status).toBe(403);
  });

  test("已鉴权时，未知的 /api 路径回 JSON 404 而不是 SPA 的 index.html", async () => {
    // 防的是一类很具体的 bug：SPA fallback 写成 app.get("*") 会把 /api/typo
    // 也吞掉，回 200 + HTML，前端拿一坨 HTML 去 JSON.parse，报出的错和真实
    // 原因毫无关系。
    const { app, assertion } = await makeApp();

    const res = await app.request("/api/does-not-exist", {
      headers: { "Cf-Access-Jwt-Assertion": assertion },
    });

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("已鉴权时 /api/me 通", async () => {
    const { app, assertion } = await makeApp();

    const res = await app.request("/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": assertion },
    });

    expect(res.status).toBe(200);
  });

  test("除了 /api/ping，每个已注册路由在没有 Access 断言时都是 403", async () => {
    // 枚举 app.routes 而不是一条条硬编码路径：Task 9/10 往 app.ts 里加新路由时，
    // 这条测试自动跟着覆盖，不用记得回来加一行。/api/ping 是容器 healthcheck，
    // 必须是唯一的例外——如果以后不小心把别的路由挪到了 accessJwt 中间件
    // 之前（哪怕只是注册顺序写反），这里会红，而不是要靠人肉审查发现。
    const { app } = await makeApp();

    const routes = app.routes.filter(
      (route) => !(route.method === "GET" && route.path === "/api/ping")
    );

    // 防的是筛选条件本身写错、把所有路由都滤掉了，导致下面的循环空转、
    // 测试看着绿实则什么也没断言过。
    expect(routes.length).toBeGreaterThan(0);

    for (const route of routes) {
      // Hono 的 `.use()`/通配符路由在 app.routes 里方法记的是 "ALL"，
      // fetch 请求没有这个方法，随便挑一个具体方法即可——accessJwt 中间件
      // 按路径拦截，不按方法区分。
      const method = route.method === "ALL" ? "GET" : route.method;
      // 把路径参数（:runId）和通配符（*）段替换成占位值，好拼出一个
      // 真能发出去的具体请求路径。
      const path = route.path
        .split("/")
        .map((segment) => (segment === "*" || segment.startsWith(":") ? "probe-value" : segment))
        .join("/");

      const res = await app.request(path, { method });

      // 只看状态码，不读 body。以后加的 SSE 路由会在鉴权通过后才开始
      // 流式返回；鉴权失败时中间件在流开始之前就短路了，所以这里不会
      // 挂起——但也没必要为了这条断言去 await 一个可能是流的 body。
      expect(res.status).toBe(403);
    }
  });
});

describe("Finding I-2 — 写端点的同源保护（csrf）", () => {
  // 复现方式：apps/dash/src/client/lib/api.ts 里 rerun/cancel 发的正是这种
  // 「没有自定义 header、没有 body」的 POST——CORS 里的 simple request，浏览器
  // 不会先发 OPTIONS 预检就直接把请求送出去。第三方页面用
  // `fetch(url, {method:"POST", credentials:"include"})` 打这个端点时读不到
  // 响应，但副作用已经发生——这里验证 csrf() 真的挡住了它，而不只是让
  // 状态码变难看。

  test("Origin 与 DASH_PUBLIC_ORIGIN 匹配：放行，副作用真的发生", async () => {
    const { app, assertion } = await makeApp();

    const res = await app.request("/api/runs/1001/rerun", {
      method: "POST",
      headers: {
        "Cf-Access-Jwt-Assertion": assertion,
        Origin: PUBLIC_ORIGIN,
      },
    });

    expect(res.status).toBe(202);
  });

  test("Origin 是第三方站点：拒绝，且副作用没有发生", async () => {
    const github = createFakeGitHubClient();
    const { app, assertion } = await makeApp({ github });

    const res = await app.request("/api/runs/1001/rerun", {
      method: "POST",
      headers: {
        "Cf-Access-Jwt-Assertion": assertion,
        Origin: "https://evil.example.com",
      },
    });

    expect(res.status).toBe(403);
    // 光看状态码不够——它证明不了 handler 真的没跑。断言 fake 客户端的
    // rerun 数组仍是空的，才是证明副作用真的没发生。
    expect(github.seed.rerun).toEqual([]);
  });

  test("完全没有 Origin 头（比如 curl/脚本）：也被拒绝，副作用没有发生", async () => {
    // 这是刻意的选择，不是意外：hono/csrf 对「不安全方法 + 没有 Origin +
    // 没有 Sec-Fetch-Site」的请求默认拒绝（两项白名单检查都在没有值的情况下
    // 直接判 false）。目前这个 API 唯一的调用方是浏览器里的 SPA（见
    // client/lib/api.ts），它发出的每一个 POST 浏览器都会带上 Origin 头
    // （现代浏览器对非安全方法一律带，不分同源跨源）；不带 Origin 的写请求
    // 只可能来自 curl 之类的脚本，而这个服务眼下没有任何这样的合法调用方，
    // 默认拒绝是「安全优先」而不是误伤——真要支持某个自动化脚本，到时候
    // 应该给它一个明确的例外（比如校验一个专用 header），而不是放宽这里。
    const github = createFakeGitHubClient();
    const { app, assertion } = await makeApp({ github });

    const res = await app.request("/api/runs/1001/rerun", {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": assertion },
    });

    expect(res.status).toBe(403);
    expect(github.seed.rerun).toEqual([]);
  });

  test("GET /api/ping 没有 Origin 头也照样 200——csrf 不该拖累健康检查", async () => {
    const { app } = await makeApp();

    const res = await app.request("/api/ping");

    expect(res.status).toBe(200);
  });

  test("GET /api/runs 没有 Origin 头也照样通——csrf 只挡不安全方法", async () => {
    const { app, assertion } = await makeApp();

    const res = await app.request("/api/runs", {
      headers: { "Cf-Access-Jwt-Assertion": assertion },
    });

    expect(res.status).toBe(200);
  });
});

describe("Finding I-5 — app.onError 集中记录、集中拼 body", () => {
  test("GitHub 错误：状态码来自 statusFor，body 不带异常类名前缀", async () => {
    const github = createFakeGitHubClient();
    github.rerunRun = async () => {
      throw new GitHubRequestError("installation token revoked", 403);
    };
    const { app, assertion } = await makeApp({ github });

    const res = await app.request("/api/runs/1001/rerun", {
      method: "POST",
      headers: {
        "Cf-Access-Jwt-Assertion": assertion,
        Origin: PUBLIC_ORIGIN,
      },
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    // Finding M-1：不能是 "GitHubRequestError: installation token revoked"。
    expect(body.error).toBe("installation token revoked");
  });
});
