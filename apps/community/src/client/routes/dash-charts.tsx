import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { Textarea } from "@astrodx/ui/components/textarea";
import { toast } from "@astrodx/ui/components/sonner";
import { type FormEvent, useState } from "react";
import { Link, useLocation, useRevalidator } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { ApiError } from "@/shared/api-client";
import type { DashChart } from "@/shared/dash";
import { DashError, DashPager, DashViewHeading, DashEmpty } from "../components/dash-ui";
import { textLinkClass } from "../components/page-title";
import { accountErrorRedirect } from "../lib/account-errors";
import { errorCodeOf } from "../lib/auth-errors";
import { getBrowserApi } from "../lib/browser";
import { dashDate, loadDash } from "../lib/dash";
import { loginHref } from "../lib/require-user";
import { dashApi } from "../queries/dash";
import type { Route } from "./+types/dash-charts";
export { headers, shouldRevalidate } from "../lib/dash";
export async function loader({ context, url }: Route.LoaderArgs) { return loadDash(context, url, api => api.charts(url.searchParams.get("cursor") || undefined)); }
export default function DashCharts({ loaderData: page }: Route.ComponentProps) {
  return <section className="space-y-4" aria-labelledby="dash-charts-heading">
    <DashViewHeading title={m.dash_charts()} description={m.dash_charts_hint()} count={page.items.length} id="dash-charts-heading" />
    {page.items.length ? <ul className="list-none space-y-3 p-0">{page.items.map(chart => <li key={`${chart.id}/${chart.revision}`}><ChartRow chart={chart} /></li>)}</ul> : <DashEmpty>{m.dash_empty()}</DashEmpty>}
    <DashPager base="/dash/charts" nextCursor={page.nextCursor} />
  </section>;
}
export function ChartRow({ chart, instanceId }: { chart: DashChart; instanceId?: string }) {
  const fieldId = instanceId ?? chart.publicId;
  const [open, setOpen] = useState(false), [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false), [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null), [reauth, setReauth] = useState(false);
  const location = useLocation(), revalidator = useRevalidator();
  const here = `${location.pathname}${location.search}`;
  const count = Array.from(reason.trim()).length;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!confirmed || count < 1 || count > 500 || pending) return;
    setPending(true); setFailure(null); setReauth(false);
    try {
      const saved = await dashApi(getBrowserApi()).moderate(chart.id, { reason: reason.trim(), expectedRevision: chart.revision });
      if (saved.status !== "moderated" || saved.pending !== false) { setFailure(m.dash_unconfirmed()); void revalidator.revalidate(); return; }
      toast.success(m.dash_taken_down()); setOpen(false);
      await revalidator.revalidate();
    } catch (error) {
      const target = accountErrorRedirect(error, here);
      if (target) { window.location.assign(target); return; }
      const code = errorCodeOf(error);
      if (code === "REAUTH_REQUIRED" || code === "SESSION_NOT_FRESH") { setReauth(true); setFailure(m.dash_reauth()); }
      else if (error instanceof ApiError && error.status === 409) { setFailure(m.dash_conflict()); }
      else if (error instanceof ApiError && error.status === 403) { setFailure(m.dash_denied_body()); }
      else { setFailure(m.dash_unconfirmed()); }
      // A failed response may follow a committed takedown. Re-read instead of claiming success.
      void revalidator.revalidate();
    } finally { setPending(false); }
  }
  return <article className="min-w-0 space-y-3 rounded-xl border p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 space-y-1">
      <h3 className="break-words font-semibold">{chart.status === "public" ? <Link to={localizeHref(`/charts/${chart.publicId}`)} className={textLinkClass}>{chart.title}</Link> : chart.title} <span className="text-muted-foreground">#{chart.publicId}</span></h3>
      <p className="break-words text-sm text-muted-foreground">{chart.artist}</p>
      <p className="text-sm">{chart.author ? <Link to={localizeHref(`/u/${chart.author.publicId}`)} className={textLinkClass}>{chart.author.name} · #{chart.author.publicId}</Link> : m.public_chart_anonymous()}</p>
    </div><span className="rounded-md bg-muted px-2 py-1 text-xs">{chart.pending ? m.dash_pending() : chart.status === "moderated" ? m.dash_chart_moderated() : m.dash_chart_public()}</span></div>
    <p className="text-xs text-muted-foreground">{m.dash_published_at({ date: dashDate(chart.publishedAt) })}</p>
    {chart.moderation ? <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
      <p className="whitespace-pre-wrap break-words">{chart.moderation.reason}</p>
      <p className="text-xs text-muted-foreground">{m.dash_moderated_by({ id: chart.moderation.actorPublicId, date: dashDate(chart.moderation.createdAt) })}</p>
    </div> : null}
    {chart.status === "public" && !open ? <Button variant="outline" onClick={() => setOpen(true)}>{m.dash_take_down()}</Button> : null}
    {open && chart.status === "public" ? <form onSubmit={submit} className="space-y-3 rounded-lg border border-destructive/30 p-4">
      <p className="text-sm">{m.dash_take_down_hint()}</p>
      <label className="grid gap-2 text-sm font-medium" htmlFor={`moderation-${fieldId}`}>{m.dash_reason()}
        <Textarea id={`moderation-${fieldId}`} name="reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} rows={3} required disabled={pending} aria-describedby={`reason-count-${fieldId}`} />
      </label>
      <p id={`reason-count-${fieldId}`} className="text-xs text-muted-foreground">{count}/500</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={pending} className="mt-1 accent-destructive" />{m.dash_confirm_take_down({ id: chart.publicId })}</label>
      <div className="flex flex-wrap gap-2"><Button type="submit" variant="destructive" disabled={pending || !confirmed || count < 1 || count > 500}>{pending ? m.dash_submitting() : m.dash_confirm()}</Button><Button type="button" variant="outline" disabled={pending} onClick={() => { setOpen(false); setReason(""); setConfirmed(false); setFailure(null); }}>{m.dash_cancel()}</Button></div>
    </form> : null}
    {failure ? <Alert variant="destructive"><p>{failure} {reauth ? <a href={loginHref(here, { reauth: "1" })} className={textLinkClass}>{m.settings_reauth()}</a> : null}</p></Alert> : null}
  </article>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <DashError error={error} />; }
