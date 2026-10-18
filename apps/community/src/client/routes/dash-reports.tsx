import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { Textarea } from "@astrodx/ui/components/textarea";
import { toast } from "@astrodx/ui/components/sonner";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useRevalidator } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import type { DashReport } from "@/shared/community-social";
import { DashError } from "../components/dash-ui";
import { SocialPager } from "../components/social-pager";
import { textLinkClass } from "../components/page-title";
import { accountErrorRedirect } from "../lib/account-errors";
import { errorCodeOf } from "../lib/auth-errors";
import { getBrowserApi } from "../lib/browser";
import { reportCategory, reportStatus, socialError } from "../lib/community-social";
import { dashDate, loadDash } from "../lib/dash";
import { loginHref } from "../lib/require-user";
import { dashApi } from "../queries/dash";
import { ChartRow } from "./dash-charts";
import type { Route } from "./+types/dash-reports";
export { headers, shouldRevalidate } from "../lib/dash";
export async function loader({ context, url }: Route.LoaderArgs) { return loadDash(context, url, api => api.reports(url.searchParams.get("status") ?? "open", url.searchParams.get("cursor") ?? undefined)); }
export default function DashReports({ loaderData }: Route.ComponentProps) {
  const location = useLocation(), filter = new URLSearchParams(location.search).get("status") ?? "open";
  return <section className="space-y-5"><h2 className="text-lg font-semibold">{m.dash_reports()}</h2><p className="text-sm text-muted-foreground">{m.dash_reports_hint()}</p>
    <nav aria-label={m.report_status_filter()} className="flex flex-wrap gap-2">{[["open", m.report_open()], ["resolved", m.report_resolved()], ["all", m.report_all()]].map(([status, label]) => <Button asChild key={status} variant={filter === status ? "default" : "outline"}><Link to={`${localizeHref("/dash/reports")}?status=${status}`}>{label}</Link></Button>)}</nav>
    {loaderData.items.length ? <ul className="list-none space-y-5 p-0">{loaderData.items.map(report => <li key={`${report.id}/${report.status}/${report.chart?.revision ?? "missing"}`}><ReportRow report={report} /></li>)}</ul> : <p>{m.dash_empty()}</p>}
    <SocialPager base="/dash/reports" status={filter} nextCursor={loaderData.nextCursor} />
  </section>;
}
function ReportRow({ report }: { report: DashReport }) {
  const [status, setStatus] = useState<"dismissed" | "actioned">("dismissed"), [note, setNote] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false), [failure, setFailure] = useState<string | null>(null), [reauth, setReauth] = useState(false);
  const location = useLocation(), here = location.pathname + location.search, revalidator = useRevalidator();
  const count = [...note.trim()].length, canAction = report.chart?.status === "moderated" && report.chart.pending === false;
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending || !confirmed || count < 1 || count > 500 || status === "actioned" && !canAction) return;
    setPending(true); setFailure(null); setReauth(false);
    try { const saved = await dashApi(getBrowserApi()).resolveReport(report.id, { status, note: note.trim() });
      if (!alive.current) return;
      if (saved.id !== report.id || saved.status !== status || saved.note !== note.trim()) { setFailure(m.dash_conflict()); void revalidator.revalidate(); return; }
      toast.success(m.report_resolution_saved()); await revalidator.revalidate();
    } catch (error) { if (alive.current) {
      const target = accountErrorRedirect(error, here); if (target) { window.location.assign(target); return; }
      if (["REAUTH_REQUIRED", "SESSION_NOT_FRESH"].includes(errorCodeOf(error) ?? "")) { setReauth(true); setFailure(m.dash_reauth()); }
      else setFailure(socialError(error));
      void revalidator.revalidate();
    } } finally { if (alive.current) setPending(false); }
  }
  return <article className="space-y-4 rounded-xl border p-4">
    <div className="space-y-2"><h3 className="break-words font-semibold">{report.title} · #{report.publicId}</h3>
      <p className="break-words text-sm text-muted-foreground">{report.artist}</p>
      <p className="text-sm">{reportCategory(report.category)} · {reportStatus(report.status)}</p>
      <p className="text-xs text-muted-foreground">{m.report_reporter({ id: report.reporterPublicId ?? "—" })} · {dashDate(report.createdAt)}</p>
      <p className="break-all text-xs text-muted-foreground">{m.report_version({ id: report.versionId })}</p>
      <p className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-sm">{report.details}</p>
    </div>
    {report.chart ? <ChartRow chart={report.chart} instanceId={`report-${report.id}`} /> : <p className="text-sm text-muted-foreground">{m.report_target_unavailable()}</p>}
    {report.status === "open" ? <form onSubmit={submit} className="space-y-3 rounded-lg border p-3">
      <label className="grid gap-1 text-sm">{m.report_resolution()}<select value={status} disabled={pending} onChange={event => setStatus(event.target.value as "dismissed" | "actioned")} className="min-h-11 rounded border bg-background px-3">
        <option value="dismissed">{m.report_dismissed()}</option><option value="actioned" disabled={!canAction}>{m.report_actioned()}</option>
      </select></label>
      {!canAction ? <p className="text-xs text-muted-foreground">{m.report_action_hint()}</p> : null}
      <label className="grid gap-1 text-sm">{m.report_resolution_note()}<Textarea required disabled={pending} value={note} onChange={event => setNote(event.target.value)} maxLength={1000} rows={3} /></label>
      <p className="text-xs text-muted-foreground">{count}/500</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={pending} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />{m.report_resolve_confirm()}</label>
      <Button type="submit" disabled={pending || !confirmed || count < 1 || count > 500 || status === "actioned" && !canAction}>{pending ? m.dash_submitting() : m.report_resolve()}</Button>
    </form> : <div className="space-y-1 rounded-lg bg-muted p-3 text-sm"><p className="whitespace-pre-wrap break-words">{report.resolutionNote}</p><p className="text-xs">{m.report_resolved_by({ id: report.resolverPublicId ?? "—" })} · {dashDate(report.resolvedAt)}</p></div>}
    {failure ? <Alert variant="destructive">{failure} {reauth ? <a href={loginHref(here, { reauth: "1" })} className={textLinkClass}>{m.settings_reauth()}</a> : null}</Alert> : null}
  </article>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <DashError error={error} />; }
