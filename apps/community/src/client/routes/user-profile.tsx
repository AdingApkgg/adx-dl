import { dehydrate, HydrationBoundary, useQuery } from "@tanstack/react-query";
import { data, Link } from "react-router";

import { m } from "@/paraglide/messages.js";
import { getLocale, localizeHref } from "@/paraglide/runtime.js";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { Avatar } from "../components/avatar";
import { getRenderApi } from "../lib/browser";
import { canonicalLink, localeAlternates, openGraph, originFrom } from "../lib/seo";
import { meQuery } from "../queries/me";
import { userQuery } from "../queries/user";
import type { Route } from "./+types/user-profile";

// 描述里的简介最多这么多个字符（搜索结果和分享卡片只显示前面一段），换行换成空格。
const DESCRIPTION_MAX = 160;

function summarize(bio: string): string {
  const flat = bio.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > DESCRIPTION_MAX ? `${chars.slice(0, DESCRIPTION_MAX).join("")}…` : flat;
}

// 个人主页（spec 第 10.5 节）：公开，允许收录；不存在的 id 是 404 页。
export async function loader({ context, params }: Route.LoaderArgs) {
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
  // meta 用的标题和描述：注销中的用户不再公开昵称和简介，也不让搜索引擎收录。
  const head =
    profile.status === "active"
      ? { title: profile.name, description: summarize(profile.bio) || m.user_page_description({ name: profile.name }), index: true }
      : { title: m.user_page_pending_title(), description: m.user_page_pending_body(), index: false };
  return { dehydratedState: dehydrate(queryClient), head };
}

export function meta({ loaderData, matches, location }: Route.MetaArgs) {
  const origin = originFrom(matches);
  const canonical = canonicalLink(origin, location.pathname);
  const { title, description, index } = loaderData.head;
  return [
    { title: `${title} - ${m.site_name()}` },
    { name: "description", content: description },
    ...(index ? [] : [{ name: "robots", content: "noindex" }]),
    canonical,
    ...localeAlternates(origin, location.pathname),
    ...openGraph({ title, description, url: canonical.href, locale: getLocale(), siteName: m.site_name() }),
  ];
}

export default function UserProfile({ loaderData, params }: Route.ComponentProps) {
  return (
    <HydrationBoundary state={loaderData.dehydratedState}>
      <UserContent id={params.id} />
    </HydrationBoundary>
  );
}

function UserContent({ id }: { id: string }) {
  const api = getRenderApi();
  const { data: profile } = useQuery(userQuery(api, id));
  const { data: me } = useQuery(meQuery(api));
  if (!profile) {
    return null;
  }
  if (profile.status === "pending_deletion") {
    return (
      <main>
        <h1>{m.user_page_pending_title()}</h1>
        <p>{m.user_page_pending_body()}</p>
        <p>{m.user_page_id({ id: profile.id })}</p>
      </main>
    );
  }
  return (
    <main>
      <p>
        <Avatar id={profile.id} name={profile.name} size={80} />
      </p>
      <h1>{profile.name}</h1>
      {/* 昵称可以重名：用户 id 和昵称一起显示，别人冒充不了（spec 第 10.5 节）。 */}
      <p>{m.user_page_id({ id: profile.id })}</p>
      {profile.bio ? <p style={{ whiteSpace: "pre-line" }}>{profile.bio}</p> : <p>{m.user_page_no_bio()}</p>}
      {/* 注册日期按 UTC 取年月日：服务端和浏览器算出来一样，hydrate 前后文字不变，搜索引擎也看得到。 */}
      <p>{m.user_page_joined({ date: profile.createdAt.slice(0, 10) })}</p>
      {me?.id === profile.id ? (
        <p>
          <Link to={localizeHref("/settings/profile")}>{m.user_page_edit()}</Link>
        </p>
      ) : null}
    </main>
  );
}
