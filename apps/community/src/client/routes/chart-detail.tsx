import { ConfirmationDialog } from "@astrodx/ui/components/confirmation-dialog";
import { AuthorNavigation } from "../components/author-navigation";
import { LoadingState } from "../components/ui-states";
import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { toast } from "@astrodx/ui/components/sonner";
import { dehydrate, HydrationBoundary, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { data, Link, useLocation, useNavigate } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { ApiError } from "@/shared/api-client";
import type { ChartDto } from "@/shared/charts";
import { apiContext, queryClientContext } from "@/shared/router-context";
import { ChartMetadataEditor } from "../components/chart-metadata-editor";
import { ChartPublication } from "../components/chart-publication";
import { ChartSummary } from "../components/chart-summary";
import { ChartUpload } from "../components/chart-upload";
import { PageTitle, textLinkClass } from "../components/page-title";
import { PrivateChartPreview } from "../components/private-chart-preview";
import { accountErrorRedirect } from "../lib/account-errors";
import { getBrowserApi, getRenderApi } from "../lib/browser";
import { chartErrorMessage } from "../lib/chart-errors";
import { requireUser } from "../lib/require-user";
import { authorChartQuery, chartsApi, type ChartPatch } from "../queries/charts";
import { useImports } from "../imports/provider";
import { meQuery } from "../queries/me";
import type { Route } from "./+types/chart-detail";
export async function loader({ context, url, params }: Route.LoaderArgs) {
  const actor = (await requireUser(context, url)).id;
  const client = context.get(queryClientContext);
  try { await client.query(authorChartQuery(context.get(apiContext), actor, params.id)); }
  catch (error) { if (error instanceof ApiError && error.status === 404) throw data(null, { status: 404 }); throw error; }
  return { actor, dehydratedState: dehydrate(client) };
}
export function meta() { return [{ title: `${m.chart_detail()} - ${m.site_name()}` }, { name: "robots", content: "noindex" }]; }
export default function ChartDetail({ loaderData, params }: Route.ComponentProps) {
  return <HydrationBoundary state={loaderData.dehydratedState}><OwnerDetail key={`${loaderData.actor}/${params.id}`} actor={loaderData.actor} id={params.id} /></HydrationBoundary>;
}
function OwnerDetail({ actor, id }: { actor: string; id: string }) {
  const client = useQueryClient(), imports = useImports();
  const { data: me } = useQuery(meQuery(getRenderApi()));
  const allowed = me?.id === actor && me.status === "active" && (!imports || imports.actor === actor);
  const [denied, setDenied] = useState<ApiError | null>(null);
  const query = useQuery({ ...authorChartQuery(getRenderApi(), actor, id), enabled: allowed && !denied });
  const denial = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status) ? query.error : denied;
  const lease = useRef(false);
  lease.current = allowed && !denial;
  useEffect(() => {
    if (denial) setDenied(denial);
    if (!allowed || denial) client.removeQueries({ queryKey: authorChartQuery(getRenderApi(), actor, id).queryKey, exact: true });
  }, [allowed, denial, actor, id, client]);
  useEffect(() => () => { lease.current = false; }, []);
  if (!allowed) return null;
  if (denial) return <Alert role="alert" variant="destructive">{chartErrorMessage(denial)}</Alert>;
  if (!query.data) return query.error ? <Alert role="alert" variant="destructive">{chartErrorMessage(query.error)}</Alert> : <LoadingState label={m.ui_route_loading()} />;
  return <Detail actor={actor} id={id} chart={query.data} queryError={query.error} isOwner={() => lease.current} />;
}
function Detail({ actor, id, chart, queryError, isOwner }: { actor: string; id: string; chart: ChartDto; queryError: unknown; isOwner: () => boolean }) {
  const client = useQueryClient(); const navigate = useNavigate(); const location = useLocation();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const isCurrent = () => alive.current && isOwner();
  const [metadataUnsaved, setMetadataUnsaved] = useState(false);
  const [pending, setPending] = useState(false); const [error, setError] = useState<unknown>();
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => {
    if (!queryError) return;
    const target = accountErrorRedirect(queryError, `${location.pathname}${location.search}`);
    if (target) window.location.assign(target);
  }, [queryError, location.pathname, location.search]);
  const refresh = async (updated?: ChartDto) => {
    if (!isCurrent()) return;
    if (updated) client.setQueryData(authorChartQuery(getBrowserApi(), actor, id).queryKey, updated);
    await Promise.all([client.invalidateQueries({ queryKey: authorChartQuery(getBrowserApi(), actor, id).queryKey, exact: true }), client.invalidateQueries({ queryKey: ["me", "charts"] })]);
  };
  const fail = (failure: unknown) => {
    if (!isCurrent()) return;
    const target = accountErrorRedirect(failure, `${location.pathname}${location.search}`);
    if (target) window.location.assign(target); else setError(failure);
  };
  const current = chart.versions.find((version) => version.id === chart.currentVersionId);
  async function patch(body: ChartPatch) {
    setPending(true); setError(undefined);
    const api = chartsApi(getBrowserApi());
    try {
      const updated = await api.patch(id, body);
      await refresh(updated); if (isCurrent()) toast.success(m.chart_saved());
    }
    catch (failure) {
      if (!isCurrent()) return;
      // Read after a lost PATCH response; never issue another revision-changing PATCH blindly.
      try {
        const actual = await api.get(id);
        const matched = (body.title === undefined || actual.title === body.title) && (body.artist === undefined || actual.artist === body.artist) &&
          (body.currentVersionId === undefined || actual.currentVersionId === body.currentVersionId);
        if (matched && !(failure instanceof ApiError && failure.status < 500)) {
          await refresh(actual); if (isCurrent()) toast.success(m.chart_saved()); return;
        }
        await refresh(actual);
      } catch {}
      fail(failure);
    } finally { if (isCurrent()) setPending(false); }
  }
  async function remove(versionId?: string) {
    setPending(true); setError(undefined);
    try {
      if (versionId) { await chartsApi(getBrowserApi()).removeVersion(id, versionId, chart!.revision); await refresh(); }
      else { await chartsApi(getBrowserApi()).remove(id, chart!.revision); if (!isCurrent()) return; client.removeQueries({ queryKey: authorChartQuery(getBrowserApi(), actor, id).queryKey, exact: true }); client.removeQueries({ queryKey: ["me", "charts"] }); await navigate(localizeHref("/me/charts")); }
      setDeleting(null);
    } catch (failure) { await refresh(); fail(failure); }
    finally { if (isCurrent()) setPending(false); }
  }
  return <main className="community-author-page space-y-6">
    <AuthorNavigation id={id} view="edit" />
    <PageTitle description={m.charts_private_hint()}>{chart.title}</PageTitle>
    <nav aria-label={m.ui_content_navigation()} className="community-content-nav"><a href="#author-metadata">{m.chart_metadata_heading()}</a><a href="#author-publication">{m.chart_publication()}</a><a href="#author-versions">{m.chart_versions()}</a><a href="#author-upload">{m.ui_author_add_version()}</a></nav>
    {current ? <div id="author-preview"><PrivateChartPreview key={current.id} id={id} versionId={current.id} summary={current.summary} /></div> : null}
    <div className="community-author-layout"><div id="author-metadata" className="min-w-0"><ChartMetadataEditor chart={chart} busy={pending} setBusy={setPending} refresh={refresh} isCurrent={isCurrent} onDirty={setMetadataUnsaved} /></div>
      <aside id="author-publication" className="min-w-0" aria-label={m.chart_publication()}><ChartPublication chart={chart} busy={pending || metadataUnsaved} setBusy={setPending} refresh={refresh} isCurrent={isCurrent} /></aside></div>
    <section tabIndex={-1} id="author-versions" aria-label={m.chart_versions()} className="community-panel space-y-5"><div className="community-section-heading"><h2 className="community-section-title">{m.chart_versions()}</h2><Link to={localizeHref("/me/charts")} className="community-inline-action">{m.charts_title()}</Link></div>
      {current ? <ChartSummary summary={current.summary} /> : null}
      <ul className="community-version-list">{chart.versions.map(version => <li key={version.id}>
        <div className="min-w-0 space-y-2"><p className="font-medium">{m.chart_version({ number: String(version.ordinal) })}{version.id === chart.currentVersionId ? <span className="community-status ml-2">{m.chart_current()}</span> : null}</p><p className="text-xs text-muted-foreground">{(version.sourceSize / (1024 * 1024)).toFixed(2)} MiB · <time dateTime={version.createdAt}>{version.createdAt.slice(0, 10)}</time></p></div>
        <div role="group" aria-label={m.ui_author_version_actions({ version: String(version.ordinal) })} className="community-toolbar"><Link className="community-inline-action" to={localizeHref(`/me/charts/${id}/review?${new URLSearchParams({version:version.id})}`)}>{m.author_review()}</Link>{version.id !== chart.currentVersionId ? <>
          <Button type="button" variant="outline" disabled={pending} onClick={() => void patch({ expectedRevision: chart.revision, currentVersionId: version.id })}>{m.chart_activate()}</Button>
          <Button type="button" variant="outline" disabled={pending || chart.publication?.versionId === version.id || chart.publicationPending === true} title={chart.publication?.versionId === version.id ? m.chart_error_published() : undefined} onClick={() => setDeleting(version.id)}>{m.chart_delete_version()}</Button>
        </> : null}</div>
      </li>)}</ul>
    </section>
    <div id="author-upload"><ChartUpload userId={actor} target={{kind:"append",id,expectedRevision:chart.revision}} onSaved={async (updated,operation) => {
      await operation.assertActive();await refresh(updated);await operation.assertActive();toast.success(m.chart_saved());
    }} /></div>
    <section className="community-danger-panel space-y-3" aria-label={m.ui_author_danger()}><h2 className="community-section-title">{m.ui_author_danger()}</h2><p className="text-sm leading-7 text-muted-foreground">{m.chart_delete_hint()}</p><Button type="button" variant="destructive" disabled={pending} onClick={() => setDeleting("chart")}>{m.chart_delete()}</Button></section>
    <ConfirmationDialog open={deleting !== null} onOpenChange={open => { if (!open) setDeleting(null); }} title={m.chart_delete_confirm()} description={deleting === "chart" ? m.chart_delete_hint() : m.ui_author_delete_version({ version: String(chart.versions.find(v => v.id === deleting)?.ordinal ?? "—") })} confirmLabel={m.chart_delete()} cancelLabel={m.avatar_cancel()} pending={pending} fallbackFocus={() => document.getElementById("author-versions")} onConfirm={() => void remove(deleting === "chart" ? undefined : deleting ?? undefined)}>
      {error || queryError ? <Alert role="alert" variant="destructive">{chartErrorMessage(error ?? queryError)}</Alert> : null}
    </ConfirmationDialog>
    {!deleting && (error || queryError) ? <Alert role="alert" variant="destructive">{chartErrorMessage(error ?? queryError)}</Alert> : null}
  </main>;
}
