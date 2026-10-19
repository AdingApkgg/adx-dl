import {DownloadProvider} from "../downloads/provider";
import {LibrarySelectionProvider} from "../components/library-selection";
import { dehydrate, HydrationBoundary, type Query } from "@tanstack/react-query";
import { data, Outlet, redirect, useRouteLoaderData } from "react-router";

import { baseLocale, isLocale } from "@/paraglide/runtime.js";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { ErrorCard } from "../components/error-card";
import { SiteShell } from "../components/site-shell";
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
  // 待注销的用户能看注销提示页和隐私说明。当前用户存进本次请求的 QueryClient，页面的 loader 再要时直接
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
    const queryClient = getBrowserQueryClient();
    const { queryKey } = meQuery(getBrowserApi());
    const target = pendingDeletionRedirect(queryClient.getQueryData(queryKey), url.pathname);
    if (target) {
      // 缓存里的"待注销"可能已经过时：不清掉，注销提示页按服务端的答案跳走后，这里又按缓存把用户送回去，来回没完。
      queryClient.removeQueries({ queryKey, exact: true });
      throw redirect(target);
    }
    return next();
  },
];

// 只要当前用户这一个查询（["me"]），并且是取到了的：子页面的查询由各自的 loader 交给浏览器。
function isMeQuery(query: Query): boolean {
  return query.queryKey.length === 1 && query.queryKey[0] === "me" && query.state.status === "success";
}

// 页头的账号区第一屏就要有头像（spec 第 7.2 节）。上面的中间件在同一个请求里已经查过当前用户，结果就在本次请求的
// QueryClient 里，这里只把它交给浏览器，不再查一次。取不到（429、5xx）时那个查询是失败的，不带它：账号区先留空，
// 浏览器里的 useQuery 会再取，已登录的人不会先看到"登录"。
export function loader({ params, context }: Route.LoaderArgs) {
  return {
    locale: params.lang ?? baseLocale,
    dehydratedState: dehydrate(context.get(queryClientContext), { shouldDehydrateQuery: isMeQuery }),
  };
}

export default function LocaleLayout({ loaderData }: Route.ComponentProps) {
  return (
    <HydrationBoundary state={loaderData.dehydratedState}>
      <DownloadProvider><LibrarySelectionProvider><SiteShell>
        <Outlet />
      </SiteShell></LibrarySelectionProvider></DownloadProvider>
    </HydrationBoundary>
  );
}

// 子页面出错（包括 /u/<不存在的 id>、/en/<不存在的地址>）都到这里：页头照样在，内容区换成出错卡片（spec 第 7.4 节）。
// 布局自己的中间件抛出的 404（/foo、/fr/x 这类第一段不是语言的地址）不归这里，由根组件的错误边界接住。
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const layout = useRouteLoaderData<typeof loader>("routes/locale");
  return (
    <HydrationBoundary state={layout?.dehydratedState}>
      <SiteShell>
        <ErrorCard error={error} />
      </SiteShell>
    </HydrationBoundary>
  );
}
