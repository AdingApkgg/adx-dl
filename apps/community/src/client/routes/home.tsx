import type {FeaturedState,NoticePage,PublicNotice} from "@/shared/community-site";
import {siteApi} from "../queries/community-site";
import {SiteNoticeList} from "../components/site-notice-list";
import {PublicChartSearchForm} from "../components/public-chart-browser";
import { Button } from "@astrodx/ui/components/button";
import { Card, CardContent } from "@astrodx/ui/components/card";
import { dehydrate, HydrationBoundary, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { m } from "@/paraglide/messages.js";
import { getLocale, localizeHref } from "@/paraglide/runtime.js";
import type { PublicChartsPageDto } from "@/shared/charts";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { PUBLIC_CHART_GRID_CLASS, PublicChartCard } from "../components/public-chart-card";
import { publicChartsApi } from "../queries/public-charts";
import { Avatar } from "../components/avatar";
import { PageTitle, textLinkClass } from "../components/page-title";
import { getBrowserApi, getBrowserQueryClient, getRenderApi } from "../lib/browser";
import { loginHref } from "../lib/require-user";
import { canonicalLink, localeAlternates, openGraph, originFrom } from "../lib/seo";
import { meQuery } from "../queries/me";
import { metaQuery } from "../queries/meta";
import type { Route } from "./+types/home";

// 首次打开：服务端预取进本次请求的 QueryClient，再整份交给浏览器（spec 第 8.3 节）。
// meta 请求失败会抛错，页面显示 :lang? 布局的错误边界（页头照样在）。当前用户（me）取不到不算：429 限流、
// 5xx 时页面照常渲染成"未登录"，没进 dehydrate 的 me，浏览器里的 useQuery 会在 hydrate 之后重试。
export async function loader({ context }: Route.LoaderArgs) {
  const queryClient = context.get(queryClientContext);
  const api = context.get(apiContext);
  const [publicCharts,featured,notices] = await Promise.all([
    publicChartsApi(api).list(undefined, 8).catch(() => null), siteApi(api).featured().catch(()=>null),siteApi(api).notices().catch(()=>null),
    queryClient.query(metaQuery(api)), queryClient.query(meQuery(api)).catch(() => undefined),
  ]);
  return { dehydratedState: dehydrate(queryClient), publicCharts,featured,notices };
}

// 站内切换：缓存里有就直接用，哪怕已经过期（staleTime: "static"），跳转不用等请求；
// 组件挂载后 useQuery 发现数据过期，会在后台刷新。缓存里没有才等这次请求。
// me 和 loader 一样：取不到就渲染成"未登录"，组件挂载后 useQuery 会重试。
export async function clientLoader() {
  const queryClient = getBrowserQueryClient();
  const [publicCharts,featured,notices] = await Promise.all([
    publicChartsApi(getBrowserApi()).list(undefined, 8).catch(() => null), siteApi(getBrowserApi()).featured().catch(()=>null),siteApi(getBrowserApi()).notices().catch(()=>null),
    queryClient.query({ ...metaQuery(getBrowserApi()), staleTime: "static" }),
    queryClient.query({ ...meQuery(getBrowserApi()), staleTime: "static" }).catch(() => undefined),
  ]);
  return { dehydratedState: null, publicCharts,featured,notices };
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
      <HomeContent publicCharts={loaderData.publicCharts} featured={loaderData.featured} notices={loaderData.notices} />
    </HydrationBoundary>
  );
}

function HomeContent({ publicCharts,featured,notices }: { publicCharts: PublicChartsPageDto | null;featured:FeaturedState|null;notices:NoticePage<PublicNotice>|null }) {
  const { data } = useQuery(metaQuery(getRenderApi()));
  const { data: me } = useQuery(meQuery(getRenderApi()));

  // Public results come from the current navigation, not the account QueryClient cache.
  return (
    <main className="space-y-6">
      <PageTitle>{m.site_name()}</PageTitle>
      <PublicChartSearchForm filters={{q:"",sort:"updated"}} base={localizeHref("/charts")}/>
      <nav className="flex flex-wrap gap-3"><Link className={textLinkClass} to={localizeHref("/forum")}>{m.site_forum()}</Link><Link className={textLinkClass} to={localizeHref("/help")}>{m.site_help()}</Link><Link className={textLinkClass} to={localizeHref("/notices")}>{m.site_notices()}</Link></nav>
      {notices?.items.length?<section className="space-y-3"><h2 className="text-xl font-semibold">{m.site_notices()}</h2><SiteNoticeList items={notices.items.slice(0,3)}/></section>:notices===null?<p role="status">{m.site_notices_unavailable()}</p>:null}
      {featured?.items.length?<section className="space-y-3"><h2 className="text-xl font-semibold">{m.site_featured()}</h2><ul className={PUBLIC_CHART_GRID_CLASS}>{featured.items.map(chart=><li key={chart.id}><PublicChartCard chart={chart} headingLevel={3}/></li>)}</ul></section>:featured===null?<p role="status">{m.site_featured_unavailable()}</p>:null}
      <Card size="sm">
        <CardContent className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
          {me ? (
            <>
              <Avatar image={me.image} id={me.id} name={me.name} size={32} /> {m.home_signed_in_as({ name: me.name })} ·{" "}
              <Link to={localizeHref(`/u/${me.publicId ?? me.id}`)} className={textLinkClass}>
                {m.home_my_page()}
              </Link>{" "}
              ·{" "}
              <Link to={localizeHref("/settings/profile")} className={textLinkClass}>
                {m.home_profile_settings()}
              </Link>{" "}
              ·{" "}
              <Link to={localizeHref("/settings/account")} className={textLinkClass}>
                {m.home_account_settings()}
              </Link>
            </>
          ) : (
            <Button asChild size="sm">
              <Link to={loginHref(localizeHref("/"))}>{m.home_sign_in()}</Link>
            </Button>
          )}
        </CardContent>
      </Card>
      <section aria-labelledby="latest-public-charts" className="space-y-4">
        <h2 id="latest-public-charts" className="text-xl font-semibold">{m.public_charts_latest()}</h2>
        <p className="text-sm text-muted-foreground">{m.public_charts_description()}</p>
        <Button asChild><Link to={localizeHref("/charts")}>{m.public_charts_browse()}</Link></Button>
        {" "}<Link to={localizeHref("/me/charts")} className={textLinkClass}>{m.charts_title()}</Link>
        {publicCharts?.items.length ? <ul className={PUBLIC_CHART_GRID_CLASS}>
          {publicCharts.items.map(chart => <li key={chart.id}><PublicChartCard chart={chart} headingLevel={3} /></li>)}
        </ul> : <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {publicCharts === null ? m.public_charts_unavailable() : m.public_charts_empty()}
        </p>}
      </section>
      <p className="text-muted-foreground">{m.home_description()}</p>
      <Link to={localizeHref("/privacy")} className={textLinkClass}>
        {m.privacy_link()}
      </Link>
      {data ? <p className="text-xs text-muted-foreground">{m.home_api_version({ version: data.apiVersion })}</p> : null}
    </main>
  );
}
