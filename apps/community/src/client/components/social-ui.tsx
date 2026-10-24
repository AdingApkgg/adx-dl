import { MotionSurface, NavigationIndicator } from "./motion-ui";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

export function SocialNavigation({ view }: { view: "feed" | "following" | "notifications" }) {
  return <nav className="community-content-nav" aria-label={m.ui_social_navigation()}>
    {([["feed", "/me/feed", m.following_feed_title()], ["following", "/me/following", m.following_manage()], ["notifications", "/me/notifications", m.site_notifications()]] as const).map(([key, href, label]) => <Link key={key} to={localizeHref(href)} aria-current={view === key ? "page" : undefined} className="community-motion-nav">{view===key?<NavigationIndicator group="social"/>:null}{label}</Link>)}
  </nav>;
}

export function groupSocialDays<T>(items: T[], date: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) { const day = date(item).slice(0, 10), group = groups.get(day); if (group) group.push(item); else groups.set(day, [item]); }
  return [...groups];
}

export function SocialEmpty({ title, children }: { title: string; children?: ReactNode }) {
  return <MotionSurface className="community-empty space-y-4"><p role="status">{title}</p>{children ? <div className="flex flex-wrap justify-center gap-3">{children}</div> : null}</MotionSurface>;
}

// Scope changes deliberately discard pagination; the two supported filters are independent.
export function notificationFilterHref(search: string, patch: { unread?: boolean; updates?: boolean }) {
  const old = new URLSearchParams(search), params = new URLSearchParams();
  if (patch.unread ?? old.get("unread") === "true") params.set("unread", "true");
  if (patch.updates ?? old.get("kind") === "author_update") params.set("kind", "author_update");
  return localizeHref("/me/notifications") + (params.size ? `?${params}` : "");
}
