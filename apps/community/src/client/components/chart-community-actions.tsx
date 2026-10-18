import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { Textarea } from "@astrodx/ui/components/textarea";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkIcon, FlagIcon } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import type { PublicChartDto } from "@/shared/charts";
import { REPORT_CATEGORIES, REPORT_TEXT_MAX, type ReportCategory } from "@/shared/community-social";
import { accountErrorRedirect } from "../lib/account-errors";
import { getRenderApi } from "../lib/browser";
import { reportCategory, socialError } from "../lib/community-social";
import { loginHref } from "../lib/require-user";
import { favoriteQuery, socialApi } from "../queries/community-social";
import { meQuery } from "../queries/me";
export function ChartCommunityActions({ chart }: { chart: PublicChartDto }) {
  const { data: me } = useQuery(meQuery(getRenderApi()));
  const location = useLocation();
  if (me === undefined) return null;
  if (!me) return <Button asChild variant="outline" className="min-h-11"><Link to={loginHref(location.pathname + location.search)}>{m.social_login()}</Link></Button>;
  if (me.status !== "active") return null;
  return <SignedInActions key={`${me.id}/${chart.publicId}/${chart.versionId}`} chart={chart} userId={me.id} />;
}
function SignedInActions({ chart, userId }: { chart: PublicChartDto; userId: string }) {
  const api = getRenderApi(), queryClient = useQueryClient(), query = favoriteQuery(api, userId, chart.publicId);
  const favorite = useQuery(query), location = useLocation(), here = location.pathname + location.search;
  const [pending, setPending] = useState(false), [failure, setFailure] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false), [reportPending, setReportPending] = useState(false), [reported, setReported] = useState(false);
  const [category, setCategory] = useState<ReportCategory>("other"), [details, setDetails] = useState("");
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const count = [...details.trim()].length;
  function failed(error: unknown) { const target = accountErrorRedirect(error, here); if (target) window.location.assign(target); else setFailure(socialError(error)); }
  async function toggleFavorite() {
    if (!favorite.data || pending) return;
    setPending(true); setFailure(null);
    try { const saved = favorite.data.favorited ? await socialApi(api).removeFavorite(chart.publicId) : await socialApi(api).addFavorite(chart.publicId);
      if (alive.current) queryClient.setQueryData(query.queryKey, saved);
    } catch (error) { if (alive.current) { failed(error); void favorite.refetch(); } }
    finally { if (alive.current) setPending(false); }
  }
  async function report(event: FormEvent) {
    event.preventDefault(); if (reportPending || count < 1 || count > REPORT_TEXT_MAX) return;
    setReportPending(true); setFailure(null);
    try { await socialApi(api).report(chart.publicId, { versionId: chart.versionId, category, details: details.trim() });
      if (alive.current) { setReporting(false); setReported(true); setDetails(""); }
    } catch (error) { if (alive.current) failed(error); }
    finally { if (alive.current) setReportPending(false); }
  }
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-3">
      {favorite.isError && !favorite.data ? <Button variant="outline" disabled={favorite.isFetching} onClick={() => void favorite.refetch()}>{m.favorite_retry()}</Button>
        : <Button type="button" variant="outline" className="min-h-11" disabled={pending || !favorite.data} aria-pressed={favorite.data?.favorited ?? false} onClick={() => void toggleFavorite()}>
          <BookmarkIcon aria-hidden="true" className={favorite.data?.favorited ? "fill-current" : undefined} />{pending ? m.dash_submitting() : favorite.data?.favorited ? m.favorite_remove() : m.favorite_add()}
        </Button>}
      <Button type="button" variant="outline" className="min-h-11" onClick={() => { setReporting(value => !value); setFailure(null); }}><FlagIcon aria-hidden="true" />{m.report_chart()}</Button>
    </div>
    {reported ? <p role="status" className="text-sm">{m.report_received()} <Link className="underline" to={localizeHref("/me/reports")}>{m.my_reports()}</Link></p> : null}
    {reporting ? <form onSubmit={report} className="space-y-3 rounded-xl border p-4">
      <p className="text-sm text-muted-foreground">{m.report_hint()}</p>
      <label className="grid gap-1 text-sm">{m.report_category()}<select disabled={reportPending} value={category} onChange={event => setCategory(event.target.value as ReportCategory)} className="min-h-11 rounded border bg-background px-3">
        {REPORT_CATEGORIES.map(category => <option key={category} value={category}>{reportCategory(category)}</option>)}
      </select></label>
      <label className="grid gap-1 text-sm">{m.report_details()}<Textarea required disabled={reportPending} value={details} onChange={event => setDetails(event.target.value)} maxLength={REPORT_TEXT_MAX * 2} rows={4} /></label>
      <p className="text-xs text-muted-foreground">{count}/{REPORT_TEXT_MAX}</p>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={reportPending || count < 1 || count > REPORT_TEXT_MAX}>{reportPending ? m.dash_submitting() : m.report_submit()}</Button><Button type="button" variant="outline" disabled={reportPending} onClick={() => setReporting(false)}>{m.dash_cancel()}</Button></div>
    </form> : null}
    {failure ? <Alert variant="destructive">{failure}</Alert> : null}
  </div>;
}
