import { LibraryIcon } from "lucide-react";
import { Link, useLocation } from "react-router";
import { Button } from "@astrodx/ui/components/button";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import type { PublicListSummary } from "@/shared/library";
import { textLinkClass } from "./page-title";

export function LibraryNavigation({ view }: { view: "lists" | "favorites" | "reports" }) {
  const items = [
    { key: "lists", href: "/me/library", label: m.library_my_lists() },
    { key: "favorites", href: "/me/favorites", label: m.my_favorites() },
    { key: "reports", href: "/me/library?view=reports", label: m.library_reports() },
  ];
  return <nav aria-label={m.ui_library_navigation()} className="community-library-tabs">
    {items.map(item => <Link key={item.key} to={localizeHref(item.href)} className="community-library-tab" aria-current={view === item.key ? "page" : undefined}>{item.label}</Link>)}
  </nav>;
}

export function PublicListCard({ list }: { list: PublicListSummary }) {
  return <article className="community-list-card">
    <div className="community-section-heading">
      <span className="community-list-icon"><LibraryIcon aria-hidden="true" className="size-5" /></span>
      <span className="community-status">#{list.publicId}</span>
    </div>
    <div className="min-w-0 space-y-2">
      <h2 className="break-words text-lg font-semibold leading-snug"><Link to={localizeHref(`/lists/${list.publicId}`)} className={`${textLinkClass} block min-h-11 py-1`}>{list.name}</Link></h2>
      <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{list.description || m.ui_library_no_description()}</p>
    </div>
    <div className="mt-auto space-y-3 border-t pt-3">
      <div className="community-section-heading text-sm">
        <Link className={`${textLinkClass} inline-flex min-h-11 min-w-0 items-center break-words`} to={localizeHref(`/u/${list.author.publicId}`)}>{list.author.name}</Link>
        <span className="community-status">{m.library_count({ count: String(list.total) })}</span>
      </div>
      <time dateTime={list.publishedAt} className="block text-xs text-muted-foreground">{m.ui_library_published_at({ date: list.publishedAt.slice(0, 10) })}</time>
    </div>
  </article>;
}

export function LibraryPager({ nextCursor }: { nextCursor: string | null }) {
  const location = useLocation();
  if (!nextCursor) return null;
  const params = new URLSearchParams(location.search);
  params.set("cursor", nextCursor);
  return <nav aria-label={m.library_more()} className="flex justify-center border-t pt-5"><Button asChild variant="outline" className="min-h-11"><Link to={`${location.pathname}?${params}`}>{m.library_more()}</Link></Button></nav>;
}
