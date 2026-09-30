import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.edge";
import { MemoryRouter, RouterContextProvider } from "react-router";

import { m } from "@/paraglide/messages.js";
import type { ApiClient } from "@/shared/api-client";
import { makeQueryClient } from "@/shared/query-client";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { loginHref } from "../lib/require-user";
import Home, { loader } from "./home";

const USER = { id: "abc2345678", name: "阿丁", image: null, status: "active", createdAt: "2026-09-29T00:00:00.000Z" };
const META = { name: "astrodx-community", apiVersion: 1 };

type LoaderArgs = Parameters<typeof loader>[0];
type LoaderData = Awaited<ReturnType<typeof loader>>;
/** 让某个接口返回这个错误状态码（限流 429、服务端出错 5xx）。 */
type Failures = { meStatus?: number; metaStatus?: number };

// 只实现首页 loader 会调用的两个接口（/api/v1/meta 和 /api/v1/me）。QueryClient 用真的
// （和服务端每个请求一份的那个一样）。
function contextFor(signedIn: boolean, { meStatus, metaStatus }: Failures = {}) {
  const api = {
    api: {
      v1: {
        meta: { $get: async () => (metaStatus ? new Response(null, { status: metaStatus }) : Response.json(META)) },
        me: {
          $get: async () => {
            if (meStatus) {
              return new Response(null, { status: meStatus });
            }
            return signedIn ? Response.json(USER) : new Response(null, { status: 401 });
          },
        },
      },
    },
  } as unknown as ApiClient;
  const context = new RouterContextProvider();
  context.set(queryClientContext, makeQueryClient());
  context.set(apiContext, api);
  return context;
}

async function visit(signedIn: boolean, failures: Failures = {}): Promise<LoaderData> {
  return loader({ context: contextFor(signedIn, failures) } as unknown as LoaderArgs);
}

// 服务端渲染只输出静态标记（不跑 effect 和事件），这里要的正是这个：首页首次打开时看到的内容。
function renderLoaderData(data: LoaderData): string {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: makeQueryClient() },
      createElement(
        MemoryRouter,
        { initialEntries: ["/"] },
        createElement(Home as unknown as ComponentType<{ loaderData: LoaderData }>, { loaderData: data })
      )
    )
  );
}

async function renderHome(signedIn: boolean): Promise<string> {
  return renderLoaderData(await visit(signedIn));
}

// loader dehydrate 出来的查询，按 queryKey 的第一段取数据。
function dataByKey(data: LoaderData): Record<string, unknown> {
  return Object.fromEntries(data.dehydratedState.queries.map((query) => [String(query.queryKey[0]), query.state.data]));
}

describe("首页 loader", () => {
  test("dehydrate 带着接口版本和当前用户（未登录是 null）", async () => {
    const signedOut = dataByKey(await visit(false));
    const signedIn = dataByKey(await visit(true));

    expect(signedOut.meta).toEqual(META);
    expect(signedOut.me).toBeNull();
    expect(signedIn.me).toEqual(USER);
  });
});

// 页面里的链接：地址和文字（React Router 的 Link 还会加 data-discover 之类的属性，这里不管）。
function links(html: string): { href: string | undefined; text: string }[] {
  return [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].map((match) => ({
    href: /\shref="([^"]*)"/.exec(match[1] ?? "")?.[1],
    text: match[2] ?? "",
  }));
}

// 首页只有 /api/v1/meta 是必须的。当前用户取不到（429 限流、5xx）时页面照常渲染成"未登录"：
// 不进错误边界；没进 dehydrate 的 me，浏览器里的 useQuery 会在 hydrate 之后重试。
describe("首页 loader：当前用户取不到", () => {
  // 500 会被查询客户端重试一次（间隔约 1 秒）才算失败，429 这类 4xx 不重试。
  for (const status of [500, 429]) {
    test(`/api/v1/me 返回 ${status}：loader 不抛，dehydrate 里有 meta、没有 me，页面渲染出'登录'链接`, async () => {
      // 用户其实登录着也一样：取不到就当没登录，不能猜。
      const data = await visit(true, { meStatus: status });
      const html = renderLoaderData(data);

      expect(dataByKey(data).meta).toEqual(META);
      expect(dataByKey(data)).not.toHaveProperty("me");
      expect(links(html)).toEqual([{ href: loginHref("/"), text: m.home_sign_in() }]);
      expect(html).toContain(m.home_api_version({ version: 1 }));
    });
  }

  test("/api/v1/meta 取不到照旧抛：只有当前用户是可选的", async () => {
    await expect(visit(false, { metaStatus: 500 })).rejects.toMatchObject({ name: "ApiError", status: 500 });
  });
});

describe("首页渲染：登录入口", () => {
  test("未登录：只有一个'登录'链接，登录后回到首页", async () => {
    const html = await renderHome(false);

    expect(links(html)).toEqual([{ href: loginHref("/"), text: m.home_sign_in() }]);
    expect(loginHref("/")).toBe("/login?next=%2F");
    expect(html).not.toContain(m.home_signed_in_as({ name: "阿丁" }));
  });

  test("已登录：显示默认头像和'已登录：昵称'，链接到我的主页、个人资料和账号设置，没有登录链接", async () => {
    const html = await renderHome(true);

    expect(html).toContain('<svg width="32" height="32"');
    expect(html).toContain(">阿</text>");
    expect(html).toContain(m.home_signed_in_as({ name: "阿丁" }));
    expect(links(html)).toEqual([
      { href: "/u/abc2345678", text: m.home_my_page() },
      { href: "/settings/profile", text: m.home_profile_settings() },
      { href: "/settings/account", text: m.home_account_settings() },
    ]);
  });

  test("原有内容不变：站名、简介和接口版本", async () => {
    for (const signedIn of [false, true]) {
      const html = await renderHome(signedIn);

      expect(html).toContain(m.site_name());
      expect(html).toContain(m.home_description());
      expect(html).toContain(m.home_api_version({ version: 1 }));
    }
  });
});
