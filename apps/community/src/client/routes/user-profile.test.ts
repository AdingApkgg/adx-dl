import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.edge";
import { MemoryRouter, RouterContextProvider } from "react-router";

import { m } from "@/paraglide/messages.js";
import type { ApiClient } from "@/shared/api-client";
import { makeQueryClient } from "@/shared/query-client";
import { apiContext, queryClientContext } from "@/shared/router-context";

import UserProfile, { loader, meta } from "./user-profile";

const ID = "abc2345678";
const ACTIVE = {
  id: ID,
  status: "active",
  name: "阿丁",
  image: null,
  bio: "写谱的\n也打歌",
  createdAt: "2026-09-29T08:00:00.000Z",
};
const VIEWER = { id: "xyz2345678", name: "路人", image: null, status: "active", createdAt: ACTIVE.createdAt, deletionPurgeAt: null };

type LoaderArgs = Parameters<typeof loader>[0];
type LoaderData = Awaited<ReturnType<typeof loader>>;
type MetaArgs = Parameters<typeof meta>[0];

// 只实现个人主页 loader 会调用的两个接口：/api/v1/users/:id 和 /api/v1/me。
function contextFor(user: object | null, viewer: object | null = null) {
  const api = {
    api: {
      v1: {
        users: {
          ":id": {
            $get: async () =>
              user ? Response.json(user) : Response.json({ error: { code: "NOT_FOUND", message: "x" } }, { status: 404 }),
          },
        },
        me: { $get: async () => (viewer ? Response.json(viewer) : new Response(null, { status: 401 })) },
      },
    },
  } as unknown as ApiClient;
  const context = new RouterContextProvider();
  context.set(queryClientContext, makeQueryClient());
  context.set(apiContext, api);
  return context;
}

function visit(user: object | null, viewer: object | null = null): Promise<LoaderData> {
  return loader({ context: contextFor(user, viewer), params: { id: ID } } as unknown as LoaderArgs);
}

function render(data: LoaderData): string {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: makeQueryClient() },
      createElement(
        MemoryRouter,
        { initialEntries: [`/u/${ID}`] },
        createElement(UserProfile as unknown as ComponentType<{ loaderData: LoaderData; params: { id: string } }>, {
          loaderData: data,
          params: { id: ID },
        })
      )
    )
  );
}

function metaOf(data: LoaderData) {
  const matches = [{ id: "root", loaderData: { origin: "https://community.test" } }];
  return meta({ loaderData: data, matches, location: { pathname: `/u/${ID}` } } as unknown as MetaArgs);
}

describe("个人主页 loader", () => {
  test("用户不存在：抛出 404", async () => {
    const thrown = await visit(null).catch((error: unknown) => error);

    expect(thrown).toMatchObject({ init: { status: 404 } });
  });

  test("找到了：dehydrate 带着这个用户的资料和访客自己（没登录是 null）", async () => {
    const data = await visit(ACTIVE);

    const byKey = Object.fromEntries(data.dehydratedState.queries.map((query) => [query.queryKey.join("/"), query.state.data]));
    expect(byKey[`users/${ID}`]).toEqual(ACTIVE);
    expect(byKey.me).toBeNull();
  });
});

describe("个人主页渲染", () => {
  test("头像、昵称、用户 ID、保留换行的简介、注册日期（UTC）", async () => {
    const html = render(await visit(ACTIVE));

    expect(html).toContain('<svg width="80"');
    expect(html).toContain("<h1>阿丁</h1>");
    expect(html).toContain(m.user_page_id({ id: ID }));
    expect(html).toContain("white-space:pre-line");
    expect(html).toContain("写谱的\n也打歌");
    expect(html).toContain(m.user_page_joined({ date: "2026-09-29" }));
  });

  test("没写简介：显示提示", async () => {
    expect(render(await visit({ ...ACTIVE, bio: "" }))).toContain(m.user_page_no_bio());
  });

  test("主人自己看：有'编辑资料'；别人看没有", async () => {
    const owner = render(await visit(ACTIVE, { ...VIEWER, id: ID }));
    const stranger = render(await visit(ACTIVE, VIEWER));

    // React Router 的 Link 会多带一个 data-discover 属性。
    expect(owner).toMatch(new RegExp(`href="/settings/profile"[^>]*>${m.user_page_edit()}</a>`));
    expect(stranger).not.toContain(m.user_page_edit());
  });

  // spec 第 10.5 节：正在注销的用户，主页显示"该用户正在注销"。
  test("正在注销：只显示'该用户正在注销'和用户 ID", async () => {
    const html = render(await visit({ id: ID, status: "pending_deletion" }));

    expect(html).toContain(m.user_page_pending_title());
    expect(html).toContain(m.user_page_id({ id: ID }));
    expect(html).not.toContain("<svg");
  });
});

describe("个人主页 meta", () => {
  test("标题是昵称，描述是简介（换行变空格），允许收录", async () => {
    const tags = metaOf(await visit(ACTIVE));

    expect(tags).toContainEqual({ title: `阿丁 - ${m.site_name()}` });
    expect(tags).toContainEqual({ name: "description", content: "写谱的 也打歌" });
    expect(tags).toContainEqual({ property: "og:title", content: "阿丁" });
    expect(tags).not.toContainEqual({ name: "robots", content: "noindex" });
    expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: `https://community.test/u/${ID}` });
  });

  test("没写简介：用默认的描述；简介太长只取前 160 个字符", async () => {
    expect(metaOf(await visit({ ...ACTIVE, bio: "" }))).toContainEqual({
      name: "description",
      content: m.user_page_description({ name: "阿丁" }),
    });
    expect(metaOf(await visit({ ...ACTIVE, bio: "长".repeat(200) }))).toContainEqual({
      name: "description",
      content: `${"长".repeat(160)}…`,
    });
  });

  test("正在注销：不收录，不出现昵称", async () => {
    const tags = metaOf(await visit({ id: ID, status: "pending_deletion" }));

    expect(tags).toContainEqual({ name: "robots", content: "noindex" });
    expect(tags).toContainEqual({ title: `${m.user_page_pending_title()} - ${m.site_name()}` });
  });
});
