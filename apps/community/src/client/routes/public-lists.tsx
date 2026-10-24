import { MotionGroup } from "../components/motion-ui";
import { data, Form, Link, useLocation } from "react-router";
import { Button } from "@astrodx/ui/components/button";
import { Input } from "@astrodx/ui/components/input";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { apiContext } from "@/shared/router-context";
import { ApiError } from "@/shared/api-client";
import { libraryApi } from "../queries/library";
import { PageTitle } from "../components/page-title";
import { PublicListCard, LibraryPager } from "../components/library-ui";
import { ErrorCard } from "../components/error-card";
import { canonicalLink, localeAlternates, originFrom } from "../lib/seo";
import type { Route } from "./+types/public-lists";
export { headers, shouldRevalidate } from "./public-charts";

export async function loader({ context, url }: Route.LoaderArgs) {
  try { return data(await libraryApi(context.get(apiContext)).publicLists(Object.fromEntries(url.searchParams)), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { throw data(null, { status: error instanceof ApiError && error.status < 500 ? error.status : 503 }); }
}
export function meta({ matches, location }: Route.MetaArgs) {
  return [{ title: m.library_public_title() }, canonicalLink(originFrom(matches), location.pathname), ...localeAlternates(originFrom(matches), location.pathname), ...(location.search ? [{ name: "robots", content: "noindex" }] : [])];
}
export default function PublicLists({ loaderData }: Route.ComponentProps) {
  const location = useLocation(), params = new URLSearchParams(location.search);
  const q = params.get("q") ?? "", author = params.get("author") ?? "", filtered = Boolean(q.trim() || author.trim());
  return <main className="space-y-6">
    <header className="community-page-heading"><PageTitle description={m.library_public_hint()}>{m.library_public_title()}</PageTitle><Button asChild variant="outline" className="min-h-11"><Link to={localizeHref("/me/library")}>{m.library_title()}</Link></Button></header>
    <Form key={`${q}/${author}`} role="search" aria-label={m.ui_library_list_search()} method="get" action={localizeHref("/lists")} className="community-filter space-y-4">
      <div className="flex flex-wrap items-end gap-3"><label className="grid min-w-0 flex-1 gap-1 text-sm font-medium">{m.ui_library_list_search()}<Input name="q" type="search" maxLength={120} defaultValue={q} className="min-h-11" /></label><Button className="min-h-11">{m.library_search()}</Button>{filtered ? <Button asChild variant="outline" className="min-h-11"><Link to={localizeHref("/lists")}>{m.ui_clear_filters()}</Link></Button> : null}</div>
      <details open={Boolean(author)} className="community-library-filters"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">{m.ui_library_advanced_filters()}</summary><label className="grid gap-1 pt-2 text-sm">{m.library_author_number()}<Input name="author" inputMode="numeric" maxLength={19} defaultValue={author} className="min-h-11 sm:max-w-xs" /></label></details>
    </Form>
    <section aria-label={m.library_public_title()} className="space-y-4"><div className="community-section-heading"><h2 className="community-section-title">{m.library_public_title()}</h2><p className="text-xs text-muted-foreground">{m.ui_library_page_count({ count: String(loaderData.items.length) })}</p></div>
      {loaderData.items.length ? <MotionGroup as="ul" className="community-list-grid">{loaderData.items.map(list => <li key={list.publicId}><PublicListCard list={list} /></li>)}</MotionGroup> : <div className="community-empty space-y-3"><p className="font-medium text-foreground">{filtered ? m.ui_library_no_results() : m.library_public_empty()}</p><p>{filtered ? m.ui_library_no_results_hint() : m.library_public_hint()}</p><Button asChild variant="outline" className="min-h-11"><Link to={localizeHref(filtered ? "/lists" : "/me/lists/new")}>{filtered ? m.ui_clear_filters() : m.library_new()}</Link></Button></div>}
    </section>
    <LibraryPager nextCursor={loaderData.nextCursor} />
  </main>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <ErrorCard error={error} />; }
