import {ShareChartButton} from "../components/share-chart-button";
import { FollowAuthor } from "../components/follow-author";
import { Button } from "@astrodx/ui/components/button";
import { Card, CardContent } from "@astrodx/ui/components/card";
import { dehydrate, HydrationBoundary, useQuery } from "@tanstack/react-query";
import { data, Link, redirect, useLocation } from "react-router";
import { ApiError } from "@/shared/api-client";
import type { PublicChartsPageDto } from "@/shared/charts";
import { publicChartFiltersFromParams, type PublicChartFilters } from "@/shared/public-chart-search";

import { m } from "@/paraglide/messages.js";
import { getLocale, localizeHref } from "@/paraglide/runtime.js";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { Avatar } from "../components/avatar";
import { PublicChartBrowser, PublicChartSearchForm } from "../components/public-chart-browser";
import { publicChartsApi } from "../queries/public-charts";
import { publicListBackState, publicListReturnState } from "../lib/public-chart-navigation";
import { PageTitle } from "../components/page-title";
import { getRenderApi } from "../lib/browser";
import { canonicalLink, localeAlternates, openGraph, originFrom } from "../lib/seo";
import { meQuery } from "../queries/me";
import { userQuery } from "../queries/user";
import type { Route } from "./+types/user-profile";

// 描述里的简介最多这么多个字符（搜索结果和分享卡片只显示前面一段），换行换成空格。
const DESCRIPTION_MAX = 160;
const profileHeaders = { "Cache-Control": "private, no-store" };
export function headers() { return profileHeaders; }
export function shouldRevalidate() { return true; }

function summarize(bio: string): string {
  const flat = bio.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > DESCRIPTION_MAX ? `${chars.slice(0, DESCRIPTION_MAX).join("")}…` : flat;
}

// 个人主页（spec 第 10.5 节）：公开，允许收录；不存在的 id 是 404 页。
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const queryClient = context.get(queryClientContext);
  const api = context.get(apiContext);
  const [profile] = await Promise.all([
    queryClient.query(userQuery(api, params.id)),
    // 访客是不是主页的主人（是的话显示"编辑资料"）。取不到（429、5xx）当作不是，页面照常显示。
    queryClient.query(meQuery(api)).catch(() => null),
  ]);
  if (!profile) {
    throw data(null, { status: 404 });
  }
  if (params.id !== profile.publicId) {
    const target = new URL(request.url);
    target.pathname = target.pathname.replace(/\/u\/[^/]+\/?$/i, `/u/${profile.publicId}`);
    return redirect(target.pathname + target.search, { status: 302, headers: profileHeaders });
  }
  // meta 用的标题和描述：注销中的用户不再公开昵称和简介，也不让搜索引擎收录。
  const head =
    profile.status === "active"
      ? { title: profile.name, description: summarize(profile.bio) || m.user_page_description({ name: profile.name }), index: true }
      : { title: m.user_page_pending_title(), description: m.user_page_pending_body(), index: false };
  let works: PublicChartsPageDto | null = null;
  let worksFilters: PublicChartFilters | null = null;
  if (profile.status === "active") {
    const url = new URL(request.url);
    try { worksFilters = { ...publicChartFiltersFromParams(url.searchParams), author: profile.publicId }; }
    catch { throw data(null, { status: 400, headers: profileHeaders }); }
    try {
      works = await publicChartsApi(api).list(url.searchParams.get("cursor") ?? undefined, undefined,
        worksFilters);
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) throw data(null, { status: error.status, headers: profileHeaders });
      // Profile remains readable, but unavailable works must not look like an empty list.
    }
  }
  return data({ dehydratedState: dehydrate(queryClient), head, works, worksFilters }, { headers: profileHeaders });
}

export function meta({ loaderData, matches, location }: Route.MetaArgs) {
  const origin = originFrom(matches);
  const canonical = canonicalLink(origin, location.pathname);
  const { title, description, index } = loaderData.head;
  return [
    { title: `${title} - ${m.site_name()}` },
    { name: "description", content: description },
    ...(index && !location.search ? [] : [{ name: "robots", content: "noindex" }]),
    canonical,
    ...localeAlternates(origin, location.pathname),
    ...openGraph({ title, description, url: canonical.href, locale: getLocale(), siteName: m.site_name() }),
  ];
}

export default function UserProfile({ loaderData, params }: Route.ComponentProps) {
  return (
    <HydrationBoundary state={loaderData.dehydratedState}>
      <UserContent id={params.id} works={loaderData.works} worksFilters={loaderData.worksFilters} />
    </HydrationBoundary>
  );
}

function UserContent({ id, works, worksFilters }: { id: string; works: PublicChartsPageDto | null; worksFilters: PublicChartFilters | null }) {
  const location = useLocation();
  const returnState = publicListReturnState(location.state);
  const returnHref = returnState?.publicListHref;
  const api = getRenderApi();
  const { data: profile } = useQuery(userQuery(api, id));
  const { data: me } = useQuery(meQuery(api));
  if (!profile) {
    return null;
  }
  if (profile.status === "pending_deletion") {
    return (
      <main className="space-y-4">
        <PageTitle description={m.user_page_pending_body()}>{m.user_page_pending_title()}</PageTitle>
        <p className="text-sm text-muted-foreground">{m.user_page_id({ id: profile.publicId })}</p>
      </main>
    );
  }
  // 资料头部（spec 第 7.5 节）：大头像、昵称、用户 ID、注册日期，下面是简介。
  return (
    <main className="space-y-6">
      {returnHref && returnHref !== location.pathname + location.search ? <Link to={returnHref} state={returnState ? publicListBackState(returnState) : undefined} className="text-sm underline">{m.public_chart_back_results()}</Link> : null}
      <div className="flex flex-wrap items-center gap-5">
        <Avatar image={profile.image} id={profile.id} name={profile.name} size={80} />
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{profile.name}</h1>
          {/* 昵称可以重名：用户 id 和昵称一起显示，别人冒充不了（spec 第 10.5 节）。 */}
          <p className="text-sm text-muted-foreground">{m.user_page_id({ id: profile.publicId })}</p>
          {/* 注册日期按 UTC 取年月日：服务端和浏览器算出来一样，hydrate 前后文字不变，搜索引擎也看得到。 */}
          <p className="text-sm text-muted-foreground">{m.user_page_joined({ date: profile.createdAt.slice(0, 10) })}</p>
        </div>
        {me?.id === profile.id ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm"><Link to={localizeHref("/settings/profile")}>{m.user_page_edit()}</Link></Button>
            <Button asChild variant="outline" size="sm"><Link to={localizeHref("/me/charts")}>{m.charts_title()}</Link></Button>
          </div>
        ) : null}
        <FollowAuthor publicId={profile.publicId}/>
        <Link className="underline" to={localizeHref(`/lists?author=${profile.publicId}`)}>{m.library_public_title()}</Link>
      </div>
      <Card>
        <CardContent>
          {profile.bio ? (
            <p className="break-words" style={{ whiteSpace: "pre-line" }}>
              {profile.bio}
            </p>
          ) : (
            <p className="text-muted-foreground">{m.user_page_no_bio()}</p>
          )}
        </CardContent>
      </Card>
      <section aria-labelledby="author-public-charts" className="space-y-4">
        <h2 id="author-public-charts" className="text-xl font-semibold">{m.user_public_charts()}</h2>
        {works && worksFilters ? <><ShareChartButton title={profile.name} resource="u" publicId={profile.publicId}/><PublicChartSearchForm filters={worksFilters} base={localizeHref(`/u/${profile.publicId}`)} />
          <PublicChartBrowser page={works} filters={worksFilters} base={localizeHref(`/u/${profile.publicId}`)} headingLevel={3} /></>
          : <p role="status" className="text-sm text-muted-foreground">{m.public_charts_unavailable()}</p>}
      </section>
    </main>
  );
}
