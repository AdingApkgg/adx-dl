import { describe, expect, test } from "bun:test";

import { paraglideMiddleware } from "@/paraglide/server.js";
import { ApiError } from "@/shared/api-client";

import routes from "../routes";
import { accountErrorRedirect } from "./account-errors";
import { pendingDeletionRedirect } from "./pending-deletion";

const PENDING = { status: "pending_deletion" };
const ACTIVE = { status: "active" };

describe("pendingDeletionRedirect", () => {
  test("待注销的用户：别的页面（包括登录页、引导页、404）一律去注销提示页", () => {
    for (const pathname of ["/", "/settings/account", "/login", "/onboarding", "/u/abc2345678", "/definitely-missing"]) {
      expect(pendingDeletionRedirect(PENDING, pathname), pathname).toBe("/account-deletion");
    }
  });

  test("已经在注销提示页上（带不带语言前缀、末尾斜杠）：不跳，不会绕圈", () => {
    for (const pathname of ["/account-deletion", "/account-deletion/", "/en/account-deletion", "/ja/account-deletion"]) {
      expect(pendingDeletionRedirect(PENDING, pathname), pathname).toBeNull();
    }
  });

  test("没登录、正常用户：不受影响", () => {
    expect(pendingDeletionRedirect(null, "/settings/account")).toBeNull();
    expect(pendingDeletionRedirect(undefined, "/")).toBeNull();
    expect(pendingDeletionRedirect(ACTIVE, "/settings/account")).toBeNull();
  });
});

// 去哪一种语言的注销提示页，取决于这次请求的语言（根路由的 Paraglide 中间件设置的）：/en 下的页面去 /en/account-deletion，
// 用户不会被丢回中文。
describe("跳转保留语言", () => {
  async function redirectFrom(url: string): Promise<string | null> {
    const response = await paraglideMiddleware(new Request(url), async () =>
      Response.json({ to: pendingDeletionRedirect(PENDING, new URL(url).pathname) })
    );
    return ((await response.json()) as { to: string | null }).to;
  }

  test("中文（不带前缀）、英文、日文", async () => {
    expect(await redirectFrom("https://x.test/settings/account")).toBe("/account-deletion");
    expect(await redirectFrom("https://x.test/en/settings/account")).toBe("/en/account-deletion");
    expect(await redirectFrom("https://x.test/ja/u/abc2345678")).toBe("/ja/account-deletion");
  });

  test("已经在带前缀的注销提示页：不跳", async () => {
    expect(await redirectFrom("https://x.test/en/account-deletion")).toBeNull();
  });
});

// 规则是"除了注销提示页，每个页面都跳"（spec 第 10.6 节）：这里按路由表核对，新加的页面也逃不掉。
// 布局（:lang?）是路由表里唯一的顶层路由，它的中间件因此对所有页面生效，带语言前缀的未知地址（*）也一样。
// 没有前缀的未知地址（/foo）：第一段被当成语言，第一个中间件 checkLocale 先判它 404，用不着跳。
describe("路由表", () => {
  const [layout, ...topLevelRest] = routes;
  const pages = layout?.children ?? [];
  const patterns = pages.map((page) => page.path ?? "");

  // 路径模板换成一个具体的地址：首页（index）是 /，:id 换成用户 id，* 换成一个不存在的地址。
  const concrete = (pattern: string) => `/${pattern.replace(":id", "abc2345678").replace("*", "definitely-missing")}`;

  test("所有页面都在同一个布局下", () => {
    expect(topLevelRest).toEqual([]);
    expect(layout?.path).toBe(":lang?");
    // 别让上面的遍历变成空转：这几个页面都在路由表里。
    for (const pattern of ["", "login", "onboarding", "settings/account", "settings/profile", "u/:id", "account-deletion", "*"]) {
      expect(patterns, pattern).toContain(pattern);
    }
  });

  test("除了注销提示页，路由表里的每个页面都把待注销的用户送去注销提示页", () => {
    for (const pattern of patterns) {
      const pathname = concrete(pattern);
      expect(pendingDeletionRedirect(PENDING, pathname), pathname).toBe(pattern === "account-deletion" ? null : "/account-deletion");
    }
  });

  // 改数据的操作被拒绝（ACCOUNT_PENDING_DELETION）时页面整页跳到这个地址：它必须是一个真正的页面，不能是 404。
  test("账号正在注销时接口出错的跳转目标，是路由表里的页面", () => {
    const target = accountErrorRedirect(new ApiError(403, "ACCOUNT_PENDING_DELETION", "x"), "/settings/account");

    expect(patterns.map(concrete)).toContain(target ?? "");
  });
});
