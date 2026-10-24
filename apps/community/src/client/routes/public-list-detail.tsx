import { MotionGroup } from "../components/motion-ui";
import { data, Link, useNavigate } from "react-router";
import { Button } from "@astrodx/ui/components/button";
import { Textarea } from "@astrodx/ui/components/textarea";
import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { m } from "@/paraglide/messages.js";
import { localizeHref, getLocale } from "@/paraglide/runtime.js";
import { ApiError } from "@/shared/api-client";
import { apiContext } from "@/shared/router-context";
import type { PublicList } from "@/shared/library";
import { libraryApi } from "../queries/library";
import { meQuery } from "../queries/me";
import { getRenderApi } from "../lib/browser";
import { loginHref } from "../lib/require-user";
import { socialError, reportCategory } from "../lib/community-social";
import { PageTitle, textLinkClass } from "../components/page-title";
import { PublicChartCard, PUBLIC_CHART_GRID_CLASS } from "../components/public-chart-card";
import { ShareChartButton } from "../components/share-chart-button";
import { LibraryPager } from "../components/library-ui";
import { ErrorCard } from "../components/error-card";
import { canonicalLink, localeAlternates, originFrom, openGraph } from "../lib/seo";
import type { Route } from "./+types/public-list-detail";
export { headers, shouldRevalidate } from "./public-charts";

export async function loader({ context, params, url }: Route.LoaderArgs) {
  try { return data(await libraryApi(context.get(apiContext)).publicList(params.id, url.searchParams.get("cursor") ?? undefined), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { throw data(null, { status: error instanceof ApiError && error.status < 500 ? error.status : 503 }); }
}
export function meta({ loaderData, matches, location }: Route.MetaArgs) {
  if (!loaderData) return [{ title: m.library_public_title() }, { name: "robots", content: "noindex" }];
  const origin = originFrom(matches), canonical = canonicalLink(origin, location.pathname);
  return [{ title: `${loaderData.name} - ${m.site_name()}` }, { name: "description", content: loaderData.description.slice(0, 160) }, canonical, ...localeAlternates(origin, location.pathname), ...openGraph({ title: loaderData.name, description: loaderData.description.slice(0, 160), url: canonical.href, locale: getLocale(), siteName: m.site_name() }), ...(location.search ? [{ name: "robots", content: "noindex" }] : [])];
}
export default function PublicListDetail({ loaderData: list }: Route.ComponentProps) {
  return <main className="space-y-6">
    <Link className={`${textLinkClass} inline-flex min-h-11 items-center`} to={localizeHref("/lists")}>{m.library_public_title()}</Link>
    <header className="community-list-detail-header space-y-4">
      <div className="community-toolbar"><span className="community-status">#{list.publicId}</span><span className="community-status is-accent">{m.library_count({ count: String(list.total) })}</span></div>
      <PageTitle>{list.name}</PageTitle>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"><Link className={`${textLinkClass} inline-flex min-h-11 items-center break-words`} to={localizeHref(`/u/${list.author.publicId}`)}>{list.author.name}</Link><time dateTime={list.publishedAt} className="text-xs text-muted-foreground">{m.ui_library_published_at({ date: list.publishedAt.slice(0, 10) })}</time></div>
      {list.description ? <p className="max-w-3xl whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">{list.description}</p> : null}
      <p className="max-w-3xl text-xs leading-6 text-muted-foreground">{m.library_current_version_hint()}</p>
    </header>
    <ListActions key={`${list.publicId}/${list.revision}`} list={list} />
    <section aria-labelledby="list-content" className="space-y-4">
      <div className="community-section-heading"><h2 id="list-content" className="community-section-title">{m.ui_library_entries()}</h2><p className="text-xs text-muted-foreground">{m.ui_library_page_count({ count: String(list.entries.length) })}</p></div>
      <MotionGroup as="ol" className={PUBLIC_CHART_GRID_CLASS}>{list.entries.map((entry, index) => <li key={`${entry.publicId ?? "missing"}/${index}`} className="min-w-0">{entry.chart ? <PublicChartCard chart={entry.chart} headingLevel={3} /> : <div className="community-list-unavailable"><p className="text-sm font-semibold">{entry.publicId ? m.social_chart_number({ id: entry.publicId }) : m.chart_missing()}</p><p className="text-sm leading-6 text-muted-foreground">{m.ui_library_unavailable_entry()}</p></div>}</li>)}</MotionGroup>
    </section>
    <LibraryPager nextCursor={list.nextCursor} />
  </main>;
}
function ListActions({ list }: { list: PublicList }) {
  const { data: me } = useQuery(meQuery(getRenderApi()));
  if (me?.status === "active") return <SignedInListActions key={me.id} list={list} />;
  return <section aria-label={m.library_copy()} className="community-panel space-y-3"><div className="community-toolbar">{me === null ? <Button asChild className="min-h-11"><Link to={loginHref(localizeHref(`/lists/${list.publicId}`))}>{m.library_copy()}</Link></Button> : null}<ShareChartButton title={list.name} publicId={list.publicId} resource="lists" /></div></section>;
}
function SignedInListActions({ list }: { list: PublicList }) {
  const api = libraryApi(getRenderApi()), navigate = useNavigate();
  const [preview, setPreview] = useState<{ ids: string[]; unavailable: number } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [reporting, setReporting] = useState(false), [details, setDetails] = useState(""), [reported, setReported] = useState(false), [category, setCategory] = useState<import("@/shared/library").LibraryReport["category"]>("other");
  const copyId = useRef<string | null>(null);
  async function copyPreview() {
    setBusy(true); setError(null);
    try {
      let page = await api.publicList(list.publicId), entries = [...page.entries];
      if (page.revision !== list.revision) throw new Error(m.library_changed());
      for (let i = 0; page.nextCursor && i < 10; i++) { page = await api.publicList(list.publicId, page.nextCursor); if (page.revision !== list.revision) throw new Error(m.library_changed()); entries.push(...page.entries); }
      setPreview({ ids: entries.filter(entry => entry.chart).map(entry => entry.publicId!), unavailable: entries.filter(entry => !entry.chart).length });
    } catch (error) { setError(error instanceof ApiError ? socialError(error) : m.library_changed()); }
    finally { setBusy(false); }
  }
  async function copy() {
    if (!preview) return;
    setBusy(true); setError(null);
    try { copyId.current ??= crypto.randomUUID(); const saved = await api.copy(list.publicId, { id: copyId.current, expectedRevision: list.revision, publicIds: preview.ids }); await navigate(localizeHref(`/me/lists/${saved.id}`)); }
    catch (error) { setError(socialError(error)); }
    finally { setBusy(false); }
  }
  async function report() {
    setBusy(true); setError(null);
    try { await api.report(list.publicId, { category, details: details.trim() }); setReported(true); setReporting(false); }
    catch (error) { setError(socialError(error)); }
    finally { setBusy(false); }
  }
  return <section aria-label={m.library_copy()} className="community-panel space-y-4">
    <div className="community-toolbar"><Button className="min-h-11" disabled={busy} onClick={() => void copyPreview()}>{m.library_copy()}</Button><ShareChartButton title={list.name} publicId={list.publicId} resource="lists" /></div>
    {preview ? <div className="space-y-3 rounded-xl border bg-muted/30 p-4"><p className="text-sm leading-6">{m.library_copy_preview({ available: String(preview.ids.length), unavailable: String(preview.unavailable) })}</p><Button className="min-h-11" disabled={busy || !preview.ids.length} onClick={() => void copy()}>{m.library_confirm_copy()}</Button></div> : null}
    <div className="space-y-3 border-t pt-3"><Button className="min-h-11" variant="ghost" disabled={busy} aria-expanded={reporting} onClick={() => setReporting(value => !value)}>{m.library_report()}</Button>
      {reporting ? <form className="space-y-3 rounded-xl border p-4" onSubmit={event => { event.preventDefault(); void report(); }}>
        <label className="grid gap-1 text-sm">{m.report_category()}<select className="min-h-11 rounded border bg-background px-2" value={category} onChange={event => setCategory(event.target.value as typeof category)}>{(["copyright", "inappropriate", "broken", "other"] as const).map(value => <option key={value} value={value}>{reportCategory(value)}</option>)}</select></label>
        <label className="grid gap-1 text-sm">{m.report_details()}<Textarea required value={details} onChange={event => setDetails(event.target.value)} maxLength={1000} /></label>
        <Button className="min-h-11" disabled={busy || !details.trim() || [...details.trim()].length > 500}>{m.report_submit()}</Button>
      </form> : null}
      {reported ? <p role="status" className="text-sm leading-6">{m.report_received()} <Link className={textLinkClass} to={localizeHref("/me/library?view=reports")}>{m.library_reports()}</Link></p> : null}
    </div>
    {error ? <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</p> : null}
  </section>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <ErrorCard error={error} />; }
