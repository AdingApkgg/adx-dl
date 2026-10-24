import { MotionGroup } from "../components/motion-ui";
import {DiscoverySearch} from "../components/discovery-search";
import {DiscoverySections} from "../components/discovery-ui";
import {discoveryApi} from "../queries/discovery";
import type {DiscoveryPage} from "@/shared/discovery-search";
import {libraryApi} from "../queries/library";
import {PublicListCard} from "../components/library-ui";
import type {PublicListSummary} from "@/shared/library";
import type {FeaturedState,NoticePage,PublicNotice} from "@/shared/community-site";
import {siteApi} from "../queries/community-site";
import {SiteNoticeList} from "../components/site-notice-list";
import { Button } from "@astrodx/ui/components/button";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { Link } from "react-router";

import { m } from "@/paraglide/messages.js";
import { getLocale, localizeHref } from "@/paraglide/runtime.js";
import type { PublicChartsPageDto } from "@/shared/charts";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { PUBLIC_CHART_GRID_CLASS, PublicChartCard } from "../components/public-chart-card";
import { publicChartsApi } from "../queries/public-charts";
import { getBrowserApi, getBrowserQueryClient } from "../lib/browser";
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
  const [publicCharts,featured,notices,lists,discovery] = await Promise.all([
    publicChartsApi(api).list(undefined, 8).catch(() => null), siteApi(api).featured().catch(()=>null),siteApi(api).notices().catch(()=>null),libraryApi(api).publicLists().catch(()=>null),discoveryApi(api).discover().catch(()=>null),
    queryClient.query(metaQuery(api)), queryClient.query(meQuery(api)).catch(() => undefined),
  ]);
  return { dehydratedState: dehydrate(queryClient), publicCharts,featured,notices,lists,discovery };
}

// 站内切换：缓存里有就直接用，哪怕已经过期（staleTime: "static"），跳转不用等请求；
// 组件挂载后 useQuery 发现数据过期，会在后台刷新。缓存里没有才等这次请求。
// me 和 loader 一样：取不到就渲染成"未登录"，组件挂载后 useQuery 会重试。
export async function clientLoader() {
  const queryClient = getBrowserQueryClient();
  const [publicCharts,featured,notices,lists,discovery] = await Promise.all([
    publicChartsApi(getBrowserApi()).list(undefined, 8).catch(() => null), siteApi(getBrowserApi()).featured().catch(()=>null),siteApi(getBrowserApi()).notices().catch(()=>null),libraryApi(getBrowserApi()).publicLists().catch(()=>null),discoveryApi(getBrowserApi()).discover().catch(()=>null),
    queryClient.query({ ...metaQuery(getBrowserApi()), staleTime: "static" }),
    queryClient.query({ ...meQuery(getBrowserApi()), staleTime: "static" }).catch(() => undefined),
  ]);
  return { dehydratedState: null, publicCharts,featured,notices,lists,discovery };
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
      <HomeContent publicCharts={loaderData.publicCharts} featured={loaderData.featured} notices={loaderData.notices} lists={loaderData.lists?.items??null} discovery={loaderData.discovery} />
    </HydrationBoundary>
  );
}

function HomeContent({ publicCharts,featured,notices,lists,discovery }: { publicCharts: PublicChartsPageDto | null;featured:FeaturedState|null;notices:NoticePage<PublicNotice>|null;lists:PublicListSummary[]|null;discovery:DiscoveryPage|null }) {
  const daily=discovery?.daily;
  return <main className="space-y-10">
    <section className="community-hero" aria-labelledby="community-home-title">
      <div className="community-hero-copy space-y-6">
        <p className="text-xs font-semibold tracking-[.18em] text-primary">ASTRODX COMMUNITY</p>
        <div className="space-y-4"><h1 id="community-home-title" className="community-hero-title">{m.ui_home_title()}</h1><p className="max-w-xl text-pretty text-sm leading-7 text-muted-foreground sm:text-base">{m.ui_home_intro()}</p></div>
        <DiscoverySearch compact/>
        <div className="community-toolbar"><Button asChild><Link to={localizeHref("/charts")}>{m.public_charts_browse()}</Link></Button><Button asChild variant="outline"><Link to={localizeHref("/me/charts/new")}>{m.chart_new()}</Link></Button><Link to={localizeHref("/help")} className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-muted-foreground hover:text-foreground">{m.site_help()}</Link></div>
      </div>
      {daily?<div className="community-hero-media space-y-3"><p className="text-xs font-semibold text-muted-foreground">{m.discovery_daily()}</p><PublicChartCard chart={daily} headingLevel={2} selectable={false}/></div>:null}
    </section>
    {notices?.items.length?<section aria-label={m.site_notices()} className="community-panel"><SiteNoticeList items={notices.items.slice(0,1)}/></section>:notices===null?<p role="status" className="text-sm text-muted-foreground">{m.site_notices_unavailable()}</p>:null}
    {featured?.items.length?<section className="space-y-4"><div className="community-section-heading"><h2 className="text-xl font-semibold">{m.site_featured()}</h2><Link className="text-sm font-medium text-primary" to={localizeHref("/charts")}>{m.discovery_more()}</Link></div><MotionGroup as="ul" className={PUBLIC_CHART_GRID_CLASS}>{featured.items.map(chart=><li key={chart.id}><PublicChartCard chart={chart} headingLevel={3} selectable={false}/></li>)}</MotionGroup></section>:featured===null?<p role="status" className="text-sm text-muted-foreground">{m.site_featured_unavailable()}</p>:null}
    {discovery?<DiscoverySections value={discovery} home/>:<section className="space-y-4"><div className="community-section-heading"><h2 className="text-xl font-semibold">{m.ui_latest_charts()}</h2><Link className="text-sm text-primary" to={localizeHref("/charts")}>{m.discovery_more()}</Link></div>{publicCharts?.items.length?<MotionGroup as="ul" className={PUBLIC_CHART_GRID_CLASS}>{publicCharts.items.map(chart=><li key={chart.id}><PublicChartCard chart={chart} headingLevel={3} selectable={false}/></li>)}</MotionGroup>:<p className="community-empty">{publicCharts===null?m.public_charts_unavailable():m.public_charts_empty()}</p>}</section>}
    {!discovery&&lists?.length?<section className="space-y-4"><h2 className="text-xl font-semibold">{m.library_public_title()}</h2><MotionGroup as="ul" className="grid gap-4 sm:grid-cols-2">{lists.slice(0,4).map(list=><li key={list.publicId}><PublicListCard list={list}/></li>)}</MotionGroup></section>:null}
  </main>;
}
