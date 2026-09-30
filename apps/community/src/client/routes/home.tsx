import { dehydrate, HydrationBoundary, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { m } from "@/paraglide/messages.js";
import { getLocale, localizeHref } from "@/paraglide/runtime.js";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { Avatar } from "../components/avatar";
import { getBrowserApi, getBrowserQueryClient, getRenderApi } from "../lib/browser";
import { loginHref } from "../lib/require-user";
import { canonicalLink, localeAlternates, openGraph, originFrom } from "../lib/seo";
import { meQuery } from "../queries/me";
import { metaQuery } from "../queries/meta";
import type { Route } from "./+types/home";

// 首次打开：服务端预取进本次请求的 QueryClient，再整份交给浏览器（spec 第 8.3 节）。
// meta 请求失败会抛错，页面显示根错误边界。当前用户（me）取不到不算：429 限流、5xx 时页面照常渲染成"未登录"，
// 没进 dehydrate 的 me，浏览器里的 useQuery 会在 hydrate 之后重试。
export async function loader({ context }: Route.LoaderArgs) {
  const queryClient = context.get(queryClientContext);
  const api = context.get(apiContext);
  await Promise.all([queryClient.query(metaQuery(api)), queryClient.query(meQuery(api)).catch(() => undefined)]);
  return { dehydratedState: dehydrate(queryClient) };
}

// 站内切换：缓存里有就直接用，哪怕已经过期（staleTime: "static"），跳转不用等请求；
// 组件挂载后 useQuery 发现数据过期，会在后台刷新。缓存里没有才等这次请求。
// me 和 loader 一样：取不到就渲染成"未登录"，组件挂载后 useQuery 会重试。
export async function clientLoader() {
  const queryClient = getBrowserQueryClient();
  await Promise.all([
    queryClient.query({ ...metaQuery(getBrowserApi()), staleTime: "static" }),
    queryClient.query({ ...meQuery(getBrowserApi()), staleTime: "static" }).catch(() => undefined),
  ]);
  return { dehydratedState: null };
}

export function meta({ matches, location }: Route.MetaArgs) {
  const origin = originFrom(matches);
  const canonical = canonicalLink(origin, location.pathname);
  return [
    { title: m.home_title() },
    { name: "description", content: m.home_description() },
    canonical,
    ...localeAlternates(origin, location.pathname),
    ...openGraph({
      title: m.home_title(),
      description: m.home_description(),
      url: canonical.href,
      locale: getLocale(),
      siteName: m.site_name(),
    }),
  ];
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <HydrationBoundary state={loaderData.dehydratedState ?? undefined}>
      <HomeContent />
    </HydrationBoundary>
  );
}

function HomeContent() {
  const { data } = useQuery(metaQuery(getRenderApi()));
  const { data: me } = useQuery(meQuery(getRenderApi()));

  return (
    <main>
      <h1>{m.site_name()}</h1>
      {/* 顶栏和头像菜单跟着页面布局做（子项目 0 之后），先放一行链接。 */}
      <p>
        {me ? (
          <>
            <Avatar id={me.id} name={me.name} size={32} /> {m.home_signed_in_as({ name: me.name })} ·{" "}
            <Link to={localizeHref("/settings/account")}>{m.home_account_settings()}</Link>
          </>
        ) : (
          <Link to={loginHref(localizeHref("/"))}>{m.home_sign_in()}</Link>
        )}
      </p>
      <p>{m.home_description()}</p>
      {data ? <p>{m.home_api_version({ version: data.apiVersion })}</p> : null}
    </main>
  );
}
