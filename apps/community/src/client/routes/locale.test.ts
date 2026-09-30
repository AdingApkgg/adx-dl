import { describe, expect, test } from "bun:test";
import { RouterContextProvider } from "react-router";

import type { ApiClient } from "@/shared/api-client";
import { makeQueryClient } from "@/shared/query-client";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { getBrowserQueryClient } from "../lib/browser";
import { checkLocale, clientMiddleware, loader, middleware } from "./locale";

function run(lang: string | undefined, url: string) {
  // 先跑中间件里的检查（会抛出跳转或 404），再跑 loader；两者都只用到 params 和 url。
  const args = { params: { lang }, url: new URL(url) };
  checkLocale(args);
  return loader(args as unknown as Parameters<typeof loader>[0]);
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("应当抛出");
}

describe("语言前缀路由", () => {
  test("没有前缀是中文", () => {
    expect(run(undefined, "https://x.test/")).toEqual({ locale: "zh" });
  });

  test("en、ja 前缀", () => {
    expect(run("en", "https://x.test/en")).toEqual({ locale: "en" });
    expect(run("ja", "https://x.test/ja/")).toEqual({ locale: "ja" });
  });

  test("/zh 前缀 301 到不带前缀的地址，保留查询串", () => {
    const response = thrownBy(() => run("zh", "https://x.test/zh/foo?x=1")) as Response;
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/foo?x=1");
  });

  test("/zh 本身跳到根路径", () => {
    for (const url of ["https://x.test/zh", "https://x.test/zh/"]) {
      const response = thrownBy(() => run("zh", url)) as Response;
      expect(response.headers.get("location"), url).toBe("/");
    }
  });

  // //evil.com 这样的 Location 是"协议相对"地址，浏览器会跳到 https://evil.com。
  // URL 解析器会把 \ 当成 /，所以 /zh/\evil.com 到这里已经是 /zh//evil.com。
  test("/zh 后面多余的斜杠不会让跳转离开本站", () => {
    const cases = [
      ["https://x.test/zh//evil.com", "/evil.com"],
      ["https://x.test/zh/\\evil.com", "/evil.com"],
      ["https://x.test/zh///evil.com", "/evil.com"],
      ["https://x.test/zh//evil.com?x=1", "/evil.com?x=1"],
    ] as const;
    for (const [url, expected] of cases) {
      const location = (thrownBy(() => run("zh", url)) as Response).headers.get("location") ?? "";
      expect(location, url).toBe(expected);
      expect(location, url).toMatch(/^\/[^/\\]/);
      expect(new URL(location, "https://x.test").origin, url).toBe("https://x.test");
    }
  });

  // /foo 这样的地址会被 :lang? 匹配成 lang=foo，要当成页面不存在。
  // /EN/... 在 Paraglide 眼里是英文，这里同样拒绝，免得一个页面有两个地址。
  test("不认识的第一段返回 404，大小写不对也算", () => {
    const cases = [
      ["foo", "https://x.test/foo"],
      ["EN", "https://x.test/EN/charts"],
    ] as const;
    for (const [lang, url] of cases) {
      const thrown = thrownBy(() => run(lang, url)) as { init?: { status?: number } };
      expect(thrown.init?.status, lang).toBe(404);
    }
  });
});

// 布局的第二个中间件：待注销的用户只能看注销提示页。它在所有子路由的 loader 之前执行。
describe("待注销的用户跳到注销提示页", () => {
  const redirectPending = middleware[1];
  type Args = Parameters<NonNullable<typeof redirectPending>>[0];

  // 只实现 /api/v1/me，respond 决定它的响应。
  function argsFor(url: string, respond: () => Response) {
    const context = new RouterContextProvider();
    context.set(queryClientContext, makeQueryClient());
    context.set(apiContext, { api: { v1: { me: { $get: async () => respond() } } } } as unknown as ApiClient);
    return { context, url: new URL(url), params: {} } as unknown as Args;
  }

  const user = (status: string) => () =>
    Response.json({ id: "abc2345678", name: "阿丁", image: null, status, createdAt: "", deletionPurgeAt: null });

  async function runMiddleware(args: Args) {
    let nextCalled = false;
    const thrown = await Promise.resolve(
      redirectPending?.(args, async () => {
        nextCalled = true;
        return new Response();
      })
    ).then(
      () => null,
      (error: unknown) => error
    );
    return { nextCalled, thrown };
  }

  test("待注销：去注销提示页（当前语言），不往下执行", async () => {
    const { nextCalled, thrown } = await runMiddleware(argsFor("https://x.test/settings/account", user("pending_deletion")));

    expect(nextCalled).toBe(false);
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("location")).toBe("/account-deletion");
  });

  test("已经在注销提示页：照常往下执行", async () => {
    expect(await runMiddleware(argsFor("https://x.test/account-deletion", user("pending_deletion")))).toEqual({
      nextCalled: true,
      thrown: null,
    });
  });

  test("没登录、正常用户、取不到当前用户（限流）：照常往下执行", async () => {
    for (const respond of [() => new Response(null, { status: 401 }), user("active"), () => new Response(null, { status: 429 })]) {
      expect(await runMiddleware(argsFor("https://x.test/settings/account", respond))).toEqual({ nextCalled: true, thrown: null });
    }
  });
});

// 布局的 clientMiddleware：浏览器里站内跳转到只有 clientLoader 的页面（首页）时，服务端的中间件不会执行，
// 用浏览器缓存里的当前用户再判断一次。只读缓存，一个请求也不发。
describe("站内跳转时待注销的用户去注销提示页", () => {
  const redirectPending = clientMiddleware[0];
  type ClientArgs = Parameters<NonNullable<typeof redirectPending>>[0];

  // getBrowserApi 要读 window.location.origin，Paraglide 在浏览器里取当前语言要读 window.location.href：临时补一个
  // window，跑完还原。fetch 换成会计数的，中间件发了请求就记下来。缓存是浏览器里的单例，每次先清空再放进这次要的当前用户。
  async function runClientMiddleware(pathname: string, cachedMe: { status: string } | null | undefined) {
    const queryClient = getBrowserQueryClient();
    const originalFetch = globalThis.fetch;
    let requests = 0;
    try {
      globalThis.fetch = (() => {
        requests += 1;
        return Promise.reject(new Error("中间件不该发请求"));
      }) as unknown as typeof fetch;
      Object.assign(globalThis, { window: { location: { origin: "https://x.test", href: "https://x.test/" } } });
      queryClient.clear();
      if (cachedMe !== undefined) {
        queryClient.setQueryData(["me"], cachedMe);
      }
      let nextCalled = false;
      let thrown: unknown = null;
      // 这个中间件是同步的：跳转是直接抛出来的，不是返回一个被拒绝的 Promise。
      try {
        await redirectPending?.({ url: new URL(`https://x.test${pathname}`) } as unknown as ClientArgs, async () => {
          nextCalled = true;
          return {};
        });
      } catch (error) {
        thrown = error;
      }
      return { nextCalled, thrown, requests };
    } finally {
      queryClient.clear();
      globalThis.fetch = originalFetch;
      Reflect.deleteProperty(globalThis, "window");
    }
  }

  test("缓存里的当前用户待注销：每个页面都去注销提示页，不往下执行", async () => {
    for (const pathname of ["/", "/login", "/onboarding", "/settings/account", "/settings/profile", "/u/abc2345678"]) {
      const { nextCalled, thrown, requests } = await runClientMiddleware(pathname, { status: "pending_deletion" });

      expect(nextCalled, pathname).toBe(false);
      expect(thrown, pathname).toBeInstanceOf(Response);
      expect((thrown as Response).status, pathname).toBe(302);
      expect((thrown as Response).headers.get("location"), pathname).toBe("/account-deletion");
      expect(requests, pathname).toBe(0);
    }
  });

  test("已经在注销提示页：照常往下执行", async () => {
    expect(await runClientMiddleware("/account-deletion", { status: "pending_deletion" })).toEqual({
      nextCalled: true,
      thrown: null,
      requests: 0,
    });
  });

  test("缓存里没有当前用户、没登录、正常用户：照常往下执行，也不去取", async () => {
    for (const cachedMe of [undefined, null, { status: "active" }]) {
      expect(await runClientMiddleware("/settings/account", cachedMe)).toEqual({ nextCalled: true, thrown: null, requests: 0 });
    }
  });
});
