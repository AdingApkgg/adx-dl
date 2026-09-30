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
import SettingsProfile, { loader, meta } from "./settings-profile";

const USER = {
  id: "abc2345678",
  name: "阿丁",
  image: null,
  status: "active",
  createdAt: "2026-09-29T00:00:00.000Z",
  deletionPurgeAt: null,
};
const PROFILE = { name: "阿丁", bio: "写谱的", onboardedAt: "2026-09-29T00:00:00.000Z" };

type LoaderArgs = Parameters<typeof loader>[0];
type LoaderData = Awaited<ReturnType<typeof loader>>;

// 只实现这个页面的 loader 会调用的两个接口（/api/v1/me 和 /api/v1/me/profile）。
function contextFor(signedIn: boolean) {
  const api = {
    api: {
      v1: {
        me: {
          $get: async () => (signedIn ? Response.json(USER) : new Response(null, { status: 401 })),
          profile: { $get: async () => Response.json(PROFILE) },
        },
      },
    },
  } as unknown as ApiClient;
  const context = new RouterContextProvider();
  context.set(queryClientContext, makeQueryClient());
  context.set(apiContext, api);
  return context;
}

async function visit(signedIn: boolean): Promise<LoaderData | { redirect: string | null }> {
  const args = { context: contextFor(signedIn), url: new URL("https://x.test/settings/profile") } as unknown as LoaderArgs;
  try {
    return await loader(args);
  } catch (thrown) {
    if (thrown instanceof Response) {
      return { redirect: thrown.headers.get("location") };
    }
    throw thrown;
  }
}

function render(data: LoaderData): string {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: makeQueryClient() },
      createElement(
        MemoryRouter,
        { initialEntries: ["/settings/profile"] },
        createElement(SettingsProfile as unknown as ComponentType<{ loaderData: LoaderData }>, { loaderData: data })
      )
    )
  );
}

describe("个人资料页", () => {
  test("未登录：跳到登录页，登录后回来", async () => {
    expect(await visit(false)).toEqual({ redirect: loginHref("/settings/profile") });
  });

  test("已登录：dehydrate 带着当前用户和资料；页面有头像、用户 ID、昵称和简介的输入框", async () => {
    const data = await visit(true);
    if ("redirect" in data) {
      throw new Error(`应当渲染页面，实际被跳转到 ${data.redirect}`);
    }

    const byKey = Object.fromEntries(data.dehydratedState.queries.map((query) => [query.queryKey.join("/"), query.state.data]));
    expect(byKey.me).toEqual(USER);
    expect(byKey["me/profile"]).toEqual(PROFILE);
    const html = render(data);
    expect(html).toContain('<svg width="64"');
    expect(html).toContain(m.user_page_id({ id: USER.id }));
    expect(html).toContain('value="阿丁"');
    expect(html).toContain("写谱的</textarea>");
    expect(html).toContain(m.profile_save());
  });

  test("不收录，标题带站名", () => {
    expect(meta()).toContainEqual({ name: "robots", content: "noindex" });
    expect(meta()).toContainEqual({ title: `${m.settings_profile_title()} - ${m.site_name()}` });
  });
});
