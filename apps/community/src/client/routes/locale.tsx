import { data, Outlet, redirect } from "react-router";

import { baseLocale, isLocale } from "@/paraglide/runtime.js";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { getBrowserApi, getBrowserQueryClient } from "../lib/browser";
import { pendingDeletionRedirect } from "../lib/pending-deletion";
import { meQuery } from "../queries/me";
import type { Route } from "./+types/locale";

type LocaleArgs = { params: { lang?: string }; url: URL };

// 基础语言不加前缀（spec 第 11.1 节）。Paraglide 会把 /zh/... 也当成中文照常渲染，
// 不在这里跳走，同一个页面就有两个地址。
export function checkLocale({ params, url }: LocaleArgs): void {
  const lang = params.lang;
  if (lang === undefined) {
    return;
  }
  if (lang === baseLocale) {
    // 开头的斜杠（URL 解析器把 \ 也变成了 /）只留一个：/zh//evil.com 若跳到 //evil.com，
    // 浏览器会当成 https://evil.com。
    const rest = `/${url.pathname.slice(`/${baseLocale}`.length).replace(/^[/\\]+/, "")}`;
    throw redirect(`${rest}${url.search}`, 301);
  }
  // isLocale 区分大小写，所以 /EN/... 也会走到这里。
  if (!isLocale(lang)) {
    throw data(null, { status: 404 });
  }
}

// 放在中间件里：它在这个路由和所有子路由的 loader 之前执行（1a 评审遗留 #5）。
export const middleware: Route.MiddlewareFunction[] = [
  (args, next) => {
    checkLocale(args);
    return next();
  },
  // 待注销的用户只能看注销提示页（spec 第 10.6 节）。当前用户存进本次请求的 QueryClient，页面的 loader 再要时直接
  // 命中缓存，不会多发请求；取不到（429、5xx）时不拦，交给页面自己处理。
  async ({ context, url }, next) => {
    const me = await context
      .get(queryClientContext)
      .query(meQuery(context.get(apiContext)))
      .catch(() => null);
    const target = pendingDeletionRedirect(me, url.pathname);
    if (target) {
      throw redirect(target);
    }
    return next();
  },
];

// 站内跳转到只有 clientLoader 的页面（首页）时，服务端的中间件不会执行：用浏览器里缓存的当前用户再看一次（不发请求）。
// 需要服务端数据的页面，跳转时的 .data 请求照样经过上面的中间件。
export const clientMiddleware: Route.ClientMiddlewareFunction[] = [
  ({ url }, next) => {
    const me = getBrowserQueryClient().getQueryData(meQuery(getBrowserApi()).queryKey);
    const target = pendingDeletionRedirect(me, url.pathname);
    if (target) {
      throw redirect(target);
    }
    return next();
  },
];

export function loader({ params }: Route.LoaderArgs) {
  return { locale: params.lang ?? baseLocale };
}

export default function LocaleLayout() {
  return <Outlet />;
}
