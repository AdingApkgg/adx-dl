import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { toast } from "@astrodx/ui/components/sonner";
import { dehydrate, HydrationBoundary, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { data, Link, useLocation, useNavigate } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { ApiError } from "@/shared/api-client";
import type { ChartDto } from "@/shared/charts";
import { apiContext, queryClientContext } from "@/shared/router-context";
import { ChartSummary } from "../components/chart-summary";
import { ChartUpload } from "../components/chart-upload";
import { PageTitle, textLinkClass } from "../components/page-title";
import { PrivateChartPreview } from "../components/private-chart-preview";
import { accountErrorRedirect } from "../lib/account-errors";
import { getBrowserApi, getRenderApi } from "../lib/browser";
import { chartErrorMessage } from "../lib/chart-errors";
import { requireUser } from "../lib/require-user";
import { chartQuery, chartsApi, type ChartPatch } from "../queries/charts";
import { meQuery } from "../queries/me";
import type { Route } from "./+types/chart-detail";
export async function loader({ context, url, params }: Route.LoaderArgs) {
  await requireUser(context, url);
  const client = context.get(queryClientContext);
  try { await client.query(chartQuery(context.get(apiContext), params.id)); }
  catch (error) { if (error instanceof ApiError && error.status === 404) throw data(null, { status: 404 }); throw error; }
  return { dehydratedState: dehydrate(client) };
}
export function meta() { return [{ title: `${m.chart_detail()} - ${m.site_name()}` }, { name: "robots", content: "noindex" }]; }
export default function ChartDetail({ loaderData, params }: Route.ComponentProps) {
  return <HydrationBoundary state={loaderData.dehydratedState}><Detail key={params.id} id={params.id} /></HydrationBoundary>;
}
function Detail({ id }: { id: string }) {
  const client = useQueryClient(); const navigate = useNavigate(); const location = useLocation();
  const { data: chart, error: queryError } = useQuery(chartQuery(getRenderApi(), id));
  const { data: me } = useQuery(meQuery(getRenderApi()));
  const [title, setTitle] = useState(chart?.title ?? ""); const [artist, setArtist] = useState(chart?.artist ?? "");
  const [pending, setPending] = useState(false); const [error, setError] = useState<unknown>();
  const [deleting, setDeleting] = useState<string | null>(null);
  const appendRevision = useRef<{ fileId: string; revision: number } | null>(null);
  const metadataDirty = useRef(false);
  const metadataRevision = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!queryError) return;
    const target = accountErrorRedirect(queryError, `${location.pathname}${location.search}`);
    if (target) window.location.assign(target);
  }, [queryError, location.pathname, location.search]);
  useEffect(() => { if (chart && !metadataDirty.current) { setTitle(chart.title); setArtist(chart.artist); } }, [chart?.title, chart?.artist]);
  const refresh = async (updated?: ChartDto) => {
    if (updated) client.setQueryData(chartQuery(getBrowserApi(), id).queryKey, updated);
    await client.invalidateQueries({ queryKey: ["me", "charts"] });
  };
  const fail = (failure: unknown) => {
    const target = accountErrorRedirect(failure, `${location.pathname}${location.search}`);
    if (target) window.location.assign(target); else setError(failure);
  };
  if (!chart || !me) return null;
  const current = chart.versions.find((version) => version.id === chart.currentVersionId);
  const acceptMetadata = (updated: ChartDto) => {
    metadataDirty.current = false; metadataRevision.current = undefined;
    setTitle(updated.title); setArtist(updated.artist);
  };
  async function patch(body: ChartPatch, metadataChange = false) {
    setPending(true); setError(undefined);
    const api = chartsApi(getBrowserApi());
    try {
      const updated = await api.patch(id, body);
      if (metadataChange) acceptMetadata(updated);
      await refresh(updated); toast.success(m.chart_saved());
    }
    catch (failure) {
      // Read after a lost PATCH response; never issue another revision-changing PATCH blindly.
      try {
        const actual = await api.get(id);
        const matched = (body.title === undefined || actual.title === body.title) && (body.artist === undefined || actual.artist === body.artist) &&
          (body.currentVersionId === undefined || actual.currentVersionId === body.currentVersionId);
        if (matched && !(failure instanceof ApiError && failure.status < 500)) {
          if (metadataChange) acceptMetadata(actual);
          await refresh(actual); toast.success(m.chart_saved()); return;
        }
        if (metadataChange) metadataRevision.current = actual.revision;
        await refresh(actual);
      } catch {}
      fail(failure);
    } finally { setPending(false); }
  }
  async function metadata(event: FormEvent) {
    event.preventDefault();
    const cleanTitle = title.trim(); const cleanArtist = artist.trim();
    if (!cleanTitle || Array.from(cleanTitle).length > 120 || Array.from(cleanArtist).length > 120) { setError(new ApiError(422, "CHART_METADATA_INVALID", "Invalid metadata")); return; }
    await patch({ expectedRevision: metadataRevision.current ?? chart!.revision, title: cleanTitle, artist: cleanArtist }, true);
  }
  async function remove(versionId?: string) {
    setPending(true); setError(undefined);
    try {
      if (versionId) { await chartsApi(getBrowserApi()).removeVersion(id, versionId, chart!.revision); await refresh(); }
      else { await chartsApi(getBrowserApi()).remove(id, chart!.revision); client.removeQueries({ queryKey: ["me", "charts"] }); await navigate(localizeHref("/me/charts")); }
      setDeleting(null);
    } catch (failure) { await refresh(); fail(failure); }
    finally { setPending(false); }
  }
  return <main className="space-y-6">
    <PageTitle description={m.charts_private_hint()}>{chart.title}</PageTitle>
    <Link to={localizeHref("/me/charts")} className={textLinkClass}>{m.charts_title()}</Link>
    <form onSubmit={metadata} className="space-y-3 rounded-lg border p-4">
      <label className="block">{m.chart_title_label()}<input value={title} maxLength={120} disabled={pending} onChange={(event) => {
        if (!metadataDirty.current) metadataRevision.current = chart.revision;
        metadataDirty.current = true; setTitle(event.target.value);
      }} className="mt-1 block w-full rounded border p-2" required /></label>
      <label className="block">{m.chart_artist_label()}<input value={artist} maxLength={120} disabled={pending} onChange={(event) => {
        if (!metadataDirty.current) metadataRevision.current = chart.revision;
        metadataDirty.current = true; setArtist(event.target.value);
      }} className="mt-1 block w-full rounded border p-2" /></label>
      <Button disabled={pending} type="submit">{m.chart_save_metadata()}</Button>
    </form>
    {current ? <><ChartSummary summary={current.summary} /><PrivateChartPreview key={current.id} id={id} versionId={current.id} summary={current.summary} /></> : null}
    <section className="space-y-3"><h2 className="font-semibold">{m.chart_versions()}</h2>
      <ul className="space-y-2">{chart.versions.map((version) => <li key={version.id} className="flex flex-wrap items-center gap-3 rounded border p-3">
        <span>{m.chart_version({ number: String(version.ordinal) })} · {(version.sourceSize / (1024 * 1024)).toFixed(2)} MiB</span>
        <time dateTime={version.createdAt} className="text-sm">{version.createdAt.slice(0, 10)}</time>
        {version.id === chart.currentVersionId ? <span className="text-sm">{m.chart_current()}</span> : <>
          <Button variant="outline" disabled={pending} onClick={() => void patch({ expectedRevision: chart.revision, currentVersionId: version.id })}>{m.chart_activate()}</Button>
          <Button variant="outline" disabled={pending} onClick={() => setDeleting(version.id)}>{m.chart_delete_version()}</Button>
        </>}
      </li>)}</ul>
    </section>
    <ChartUpload userId={me.id} onSave={async (file) => {
      if (appendRevision.current?.fileId !== file.id) appendRevision.current = { fileId: file.id, revision: chart.revision };
      try {
        const updated = await chartsApi(getBrowserApi()).append(id, file.id, appendRevision.current.revision);
        appendRevision.current = null; await refresh(updated); toast.success(m.chart_saved());
      } catch (failure) {
        if (failure instanceof ApiError && failure.code === "CHART_CHANGED") { appendRevision.current = null; await refresh(); }
        throw failure;
      }
    }} />
    <Button variant="outline" disabled={pending} onClick={() => setDeleting("chart")}>{m.chart_delete()}</Button>
    {deleting ? <section role="alertdialog" aria-label={m.chart_delete_confirm()} className="space-y-3 rounded border p-4">
      <p>{m.chart_delete_confirm()}</p><p className="text-sm text-muted-foreground">{m.chart_delete_hint()}</p>
      <div className="flex gap-2"><Button disabled={pending} onClick={() => void remove(deleting === "chart" ? undefined : deleting)}>{m.chart_delete()}</Button>
        <Button variant="outline" disabled={pending} onClick={() => setDeleting(null)}>{m.avatar_cancel()}</Button></div>
    </section> : null}
    {error || queryError ? <Alert role="alert" variant="destructive">{chartErrorMessage(error ?? queryError)}</Alert> : null}
  </main>;
}
