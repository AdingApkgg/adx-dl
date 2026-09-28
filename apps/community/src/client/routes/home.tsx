import { dehydrate, HydrationBoundary, useQuery } from "@tanstack/react-query";

import { m } from "@/paraglide/messages.js";
import { getLocale } from "@/paraglide/runtime.js";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { getBrowserApi, getBrowserQueryClient, getRenderApi } from "../lib/browser";
import { canonicalLink, localeAlternates, openGraph, originFrom } from "../lib/seo";
import { metaQuery } from "../queries/meta";
import type { Route } from "./+types/home";

// 首次打开：服务端预取进本次请求的 QueryClient，再整份交给浏览器（spec 第 8.3 节）。
// 请求失败会抛错，页面显示根错误边界。
export async function loader({ context }: Route.LoaderArgs) {
  const queryClient = context.get(queryClientContext);
  await queryClient.query(metaQuery(context.get(apiContext)));
  return { dehydratedState: dehydrate(queryClient) };
}

// 站内切换：缓存里有就直接用，哪怕已经过期（staleTime: "static"），跳转不用等请求；
// 组件挂载后 useQuery 发现数据过期，会在后台刷新。缓存里没有才等这次请求。
export async function clientLoader() {
  await getBrowserQueryClient().query({ ...metaQuery(getBrowserApi()), staleTime: "static" });
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

  return (
    <main>
      <h1>{m.site_name()}</h1>
      <p>{m.home_description()}</p>
      {data ? <p>{m.home_api_version({ version: data.apiVersion })}</p> : null}
    </main>
  );
}
