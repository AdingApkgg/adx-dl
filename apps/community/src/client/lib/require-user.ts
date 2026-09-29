import { redirect, type RouterContextProvider } from "react-router";

import { localizeHref } from "@/paraglide/runtime.js";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { meQuery } from "../queries/me";

/** 登录页的地址（当前语言），登录后回到 next。 */
export function loginHref(next: string, extra: Record<string, string> = {}): string {
  return `${localizeHref("/login")}?${new URLSearchParams({ next, ...extra })}`;
}

// 需要登录的页面在 loader 里调用（spec 第 11.4 节：未登录跳到 /login?next=<原地址>）。
// 取到的当前用户留在本次请求的 QueryClient 里，页面 dehydrate 时一并带给浏览器。
export async function requireUser(context: Readonly<RouterContextProvider>, url: URL) {
  const me = await context.get(queryClientContext).query(meQuery(context.get(apiContext)));
  if (!me) {
    throw redirect(loginHref(`${url.pathname}${url.search}`));
  }
  return me;
}
