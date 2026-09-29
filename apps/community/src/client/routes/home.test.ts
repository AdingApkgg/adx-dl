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

type LoaderArgs = Parameters<typeof loader>[0];
type LoaderData = Awaited<ReturnType<typeof loader>>;

// 只实现首页 loader 会调用的两个接口（/api/v1/meta 和 /api/v1/me）。QueryClient 用真的
// （和服务端每个请求一份的那个一样）。
function contextFor(signedIn: boolean) {
  const api = {
    api: {
      v1: {
        meta: { $get: async () => Response.json({ name: "astrodx-community", apiVersion: 1 }) },
        me: { $get: async () => (signedIn ? Response.json(USER) : new Response(null, { status: 401 })) },
      },
    },
  } as unknown as ApiClient;
  const context = new RouterContextProvider();
  context.set(queryClientContext, makeQueryClient());
  context.set(apiContext, api);
  return context;
}

async function visit(signedIn: boolean): Promise<LoaderData> {
  return loader({ context: contextFor(signedIn) } as unknown as LoaderArgs);
}

// 服务端渲染只输出静态标记（不跑 effect 和事件），这里要的正是这个：首页首次打开时看到的内容。
async function renderHome(signedIn: boolean): Promise<string> {
  const data = await visit(signedIn);
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

// loader dehydrate 出来的查询，按 queryKey 的第一段取数据。
function dataByKey(data: LoaderData): Record<string, unknown> {
  return Object.fromEntries(data.dehydratedState.queries.map((query) => [String(query.queryKey[0]), query.state.data]));
}

describe("首页 loader", () => {
  test("dehydrate 带着接口版本和当前用户（未登录是 null）", async () => {
    const signedOut = dataByKey(await visit(false));
    const signedIn = dataByKey(await visit(true));

    expect(signedOut.meta).toEqual({ name: "astrodx-community", apiVersion: 1 });
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

describe("首页渲染：登录入口", () => {
  test("未登录：只有一个'登录'链接，登录后回到首页", async () => {
    const html = await renderHome(false);

    expect(links(html)).toEqual([{ href: loginHref("/"), text: m.home_sign_in() }]);
    expect(loginHref("/")).toBe("/login?next=%2F");
    expect(html).not.toContain(m.home_signed_in_as({ name: "阿丁" }));
  });

  test("已登录：显示'已登录：昵称'，只有一个账号设置的链接，没有登录链接", async () => {
    const html = await renderHome(true);

    expect(html).toContain(m.home_signed_in_as({ name: "阿丁" }));
    expect(links(html)).toEqual([{ href: "/settings/account", text: m.home_account_settings() }]);
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
