import { ArrowLeftIcon } from "lucide-react";
import { Link, useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

export function AuthorNavigation({ id, view, version, difficulty }: { id?: string; view: "new" | "edit" | "review" | "compare"; version?: string; difficulty?: number }) {
  const location = useLocation();
  const review = new URLSearchParams(), compare = new URLSearchParams();
  if (version) { review.set("version", version); compare.set("right", version); }
  if (difficulty !== undefined) { review.set("difficulty", String(difficulty)); compare.set("difficulty", String(difficulty)); }
  const items = id ? [
    { key: "edit", href: `/me/charts/${id}`, label: m.chart_detail() },
    { key: "review", href: `/me/charts/${id}/review${review.size ? `?${review}` : ""}`, label: m.author_review() },
    { key: "compare", href: `/me/charts/${id}/compare${compare.size ? `?${compare}` : ""}`, label: m.author_compare() },
  ] : [{ key: "new", href: "/me/charts/new", label: m.chart_new() }];
  return <nav aria-label={m.ui_author_navigation()} className="community-author-navigation"><Link className="community-inline-action justify-start" to={localizeHref("/me/workbench")}><ArrowLeftIcon aria-hidden="true" className="size-4" />{m.author_workbench()}</Link><div className="community-content-nav">{items.map(item => <Link key={item.key} to={view === item.key ? location.pathname + location.search : localizeHref(item.href)} aria-current={view === item.key ? "page" : undefined}>{item.label}</Link>)}</div><Link className="community-inline-action" to={localizeHref(`/help/${view === "new" ? "upload" : "author"}`)}>{m.site_help()}</Link></nav>;
}
