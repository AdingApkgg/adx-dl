import {ShareChartButton} from "../components/share-chart-button";
import { FollowAuthor } from "../components/follow-author";
import { Button } from "@astrodx/ui/components/button";
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
      <section id="author-profile" aria-label={m.ui_social_profile()} className="community-profile-panel community-panel">
        <div className="community-profile-identity">
          <Avatar image={profile.image} id={profile.id} name={profile.name} size={80} />
          <div className="min-w-0 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{m.ui_social_profile()}</p>
            <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">{profile.name}</h1>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"><span>{m.user_page_id({ id: profile.publicId })}</span><span>{m.user_page_joined({ date: profile.createdAt.slice(0, 10) })}</span></div>
          </div>
        </div>
        <p className="community-profile-bio break-words text-sm leading-7" style={{ whiteSpace: "pre-line" }}>{profile.bio || m.user_page_no_bio()}</p>
        <div className="community-profile-actions">
          <FollowAuthor publicId={profile.publicId} />
          {me?.id === profile.id ? <Button asChild variant="outline" className="min-h-11"><Link to={localizeHref("/settings/profile")}>{m.user_page_edit()}</Link></Button> : null}
          {me?.id === profile.id ? <Button asChild variant="outline" className="min-h-11"><Link to={localizeHref("/me/workbench")}>{m.ui_social_workbench()}</Link></Button> : null}
          <Button asChild variant="outline" className="min-h-11"><Link to={localizeHref(`/lists?author=${profile.publicId}`)}>{m.ui_social_author_lists()}</Link></Button>
          <ShareChartButton title={profile.name} resource="u" publicId={profile.publicId} label={m.ui_social_share_profile()} />
        </div>
      </section>
      <nav className="community-content-nav" aria-label={m.ui_content_navigation()}><a href="#author-profile">{m.ui_social_profile()}</a><a href="#author-public-charts">{m.user_public_charts()}</a></nav>
      <section aria-labelledby="author-public-charts" className="space-y-4">
        <div className="community-section-heading"><h2 id="author-public-charts" className="community-section-title">{m.user_public_charts()}</h2></div>
        <p className="text-sm leading-6 text-muted-foreground">{m.ui_social_public_works_hint()}</p>
        {works && worksFilters ? <><PublicChartSearchForm lockedAuthor filters={worksFilters} base={localizeHref(`/u/${profile.publicId}`)} />
          <PublicChartBrowser page={works} filters={worksFilters} base={localizeHref(`/u/${profile.publicId}`)} headingLevel={3} /></>
          : <p role="status" className="text-sm text-muted-foreground">{m.public_charts_unavailable()}</p>}
      </section>
    </main>
  );
}
