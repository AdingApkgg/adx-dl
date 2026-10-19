import { Badge } from "@astrodx/ui/components/badge";
import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { ApiError } from "@/shared/api-client";
import type { VersionFingerprint } from "@/shared/author-workbench";
import { publicationConfirmationKey } from "../author/publication-review";
import { compareFingerprints } from "../author/compare";
import type { ChartDto } from "@/shared/charts";
import { accountErrorRedirect } from "../lib/account-errors";
import { getRenderApi } from "../lib/browser";
import { chartErrorMessage } from "../lib/chart-errors";
import { chartsApi } from "../queries/charts";
import { ChartSummary } from "./chart-summary";
import { PrivateChartPreview } from "./private-chart-preview";

type Intent = { versionId: string; title: string; artist: string; description: string; credits: string; tags: ChartDto["tags"]; releaseNote: string } | null;
function matches(chart: ChartDto, intent: Intent) {
  if (chart.publicationPending !== false) return false;
  return intent === null ? chart.publication === null : chart.publication?.versionId === intent.versionId &&
    chart.publication.title === intent.title && chart.publication.artist === intent.artist && chart.publication.description === intent.description && chart.publication.credits === intent.credits && JSON.stringify(chart.publication.tags) === JSON.stringify(intent.tags) && chart.publication.releaseNote === intent.releaseNote;
}
export function ChartPublication({ chart, busy, setBusy, refresh }: {
  chart: ChartDto; busy: boolean; setBusy: (busy: boolean) => void;
  refresh: (chart: ChartDto) => Promise<void>;
}) {
  const location = useLocation();
  const [interactive,setInteractive]=useState(false);
  useEffect(()=>setInteractive(true),[]);
  const fail = (error: unknown) => {
    const target = accountErrorRedirect(error, `${location.pathname}${location.search}`);
    if (target) window.location.assign(target);
  };
  const [versionId, setVersionId] = useState("");
  const confirmationKey = publicationConfirmationKey(chart,versionId);
  const [confirmedKey,setConfirmedKey] = useState<string|null>(null);
  const confirmed = confirmedKey === confirmationKey;
  const setConfirmed = (value:boolean) => setConfirmedKey(value?confirmationKey:null);
  const [fingerprints,setFingerprints]=useState<{key:string;items:VersionFingerprint[];error:unknown}>({key:"",items:[],error:null});
  const fingerprintKey=JSON.stringify([chart.id,versionId,chart.publication?.versionId]);
  useEffect(()=>{const [chartId,versionId,publishedId]=JSON.parse(fingerprintKey) as [string,string,string|null];const aborter=new AbortController();setFingerprints({key:fingerprintKey,items:[],error:null});if(!versionId)return()=>aborter.abort();
    void(async()=>{const api=chartsApi(getRenderApi()),items=[await api.fingerprint(chartId,versionId,aborter.signal)];if(publishedId&&publishedId!==versionId)items.unshift(await api.fingerprint(chartId,publishedId,aborter.signal));if(!aborter.signal.aborted)setFingerprints({key:fingerprintKey,items,error:null});})().catch(error=>{if(!aborter.signal.aborted)setFingerprints({key:fingerprintKey,items:[],error});});return()=>aborter.abort();
  },[fingerprintKey]);
  const [withdrawing, setWithdrawing] = useState(false);
  const [reconcile, setReconcile] = useState(false);
  const [intent, setIntent] = useState<Intent>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<unknown>();
  const uncertain = reconcile || chart.publicationPending !== false;
  const publishedVersion = chart.versions.find(version => version.id === chart.publication?.versionId);
  const privateChanges = !uncertain && chart.publication && (chart.currentVersionId !== chart.publication.versionId || chart.title !== chart.publication.title || chart.artist !== chart.publication.artist || chart.description !== chart.publication.description || chart.credits !== chart.publication.credits || JSON.stringify(chart.tags) !== JSON.stringify(chart.publication.tags) || publishedVersion?.releaseNote !== chart.publication.releaseNote);
  const selected = chart.versions.find((version) => version.id === versionId);
  const api = chartsApi(getRenderApi());
  const accept = async (actual: ChartDto, target: Intent, allowSuccess: boolean) => {
    await refresh(actual);
    if (allowSuccess && matches(actual, target)) {
      setReconcile(false); setWithdrawing(false); setConfirmed(false);
      setStatus(target ? m.chart_publication_saved() : m.chart_publication_withdrawn());
      return true;
    }
    setReconcile(actual.publicationPending !== false);
    setStatus(actual.publicationPending !== false ? m.chart_publication_pending() : m.chart_publication_retry());
    return false;
  };
  async function mutate(target: Intent) {
    setBusy(true); setError(undefined); setStatus(""); setIntent(target);
    try {
      const actual = target ? await api.publish(chart.id, chart.revision, target.versionId) : await api.withdraw(chart.id, chart.revision);
      if (!await accept(actual, target, true)) setError(new ApiError(409, "CHART_CHANGED", "Publication changed"));
    } catch (failure) {
      // A lost response can follow a committed mutation. Read before offering an explicit retry.
      setReconcile(true);
      try {
        const actual = await api.get(chart.id);
        const conflict = failure instanceof ApiError && failure.status < 500;
        if (await accept(actual, target, !conflict)) return;
      } catch { setStatus(m.chart_publication_pending()); }
      setError(failure); fail(failure);
    } finally { setBusy(false); }
  }
  async function check() {
    setBusy(true); setError(undefined);
    try { await accept(await api.get(chart.id), intent, true); }
    catch (failure) { setError(failure); fail(failure); }
    finally { setBusy(false); }
  }
  return <section id="publication" aria-label={m.chart_publication()} className="space-y-3 rounded-lg border p-4">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="font-semibold">{m.chart_publication()}</h2>
    <a href={localizeHref("/help/publication")} className="inline-flex min-h-11 items-center text-sm underline">{m.site_help_publication_title()}</a>
      <Badge variant={uncertain ? "outline" : chart.publication ? "default" : "secondary"}>
        {uncertain ? m.chart_publication_status_pending() : chart.publication ? m.chart_publication_status_public() : m.chart_publication_status_private()}
      </Badge>
    </div>
    <p className="text-sm">{m.chart_publication_hint()}</p><p className="text-sm">{m.author_saved_metadata()}</p>
    {chart.publication && !uncertain ? <div className="space-y-1 text-sm">
      <p>{m.chart_publication_current({ title: chart.publication.title, artist: chart.publication.artist })}</p>
      {publishedVersion ? <p>{m.chart_publication_published_version({ number: String(publishedVersion.ordinal) })}</p> : null}
      <p className="break-all text-xs text-muted-foreground">{m.chart_publication_version_id({ id: chart.publication.versionId })}</p>
      <Link className="underline" to={localizeHref(`/charts/${chart.publicId ?? chart.id}`)}>{m.chart_publication_view()}</Link>
    </div> : !uncertain ? <p>{m.chart_publication_private()}</p> : null}
    {privateChanges ? <p className="rounded-md border bg-muted/50 p-3 text-sm">{m.chart_publication_private_changes()}</p> : null}
    <label className="block">{m.chart_publication_version()}
      <select value={versionId} disabled={!interactive || busy || reconcile || uncertain} onChange={(event) => { setVersionId(event.target.value); setConfirmed(false); setStatus(""); }} className="ml-2 rounded border p-2">
        <option value="">{m.chart_publication_choose()}</option>
        {chart.versions.map((version) => <option key={version.id} value={version.id}>{m.chart_version({ number: String(version.ordinal) })}</option>)}
      </select>
    </label>
    {selected ? <nav className="flex flex-wrap gap-3"><Link className="underline" to={localizeHref(`/me/charts/${chart.id}/review?version=${selected.id}`)}>{m.author_review()}</Link><Link className="underline" to={localizeHref(`/me/charts/${chart.id}/compare?right=${selected.id}${chart.publication?`&left=${chart.publication.versionId}`:""}`)}>{m.author_compare()}</Link></nav>:null}
    {selected&&fingerprints.key===fingerprintKey?<div className="space-y-2 rounded border p-3"><h3>{m.author_package()}</h3>{fingerprints.error?<p role="status">{m.author_analysis_failed()}</p>:!fingerprints.items.length?<p>{m.author_analysis_loading()}</p>:<>{fingerprints.items.map(f=><p key={f.versionId} className="break-all font-mono text-xs">SHA256 {f.source.sha256} · {f.source.size} B</p>)}{fingerprints.items.length===2?<p>{compareFingerprints(fingerprints.items[0],fingerprints.items[1]).archiveSame?m.author_unchanged():compareFingerprints(fingerprints.items[0],fingerprints.items[1]).previewSame?m.author_archive_changed():m.author_different()}</p>:null}</>}</div>:null}
    {selected ? <div className="grid gap-3 md:grid-cols-2">
      {chart.publication ? <div className="space-y-2 rounded border p-3"><h3 className="font-semibold">{m.chart_metadata_current_snapshot()}</h3><p>{chart.publication.title} · {chart.publication.artist || "—"}</p>
        {publishedVersion ? <><p>{m.chart_version({ number: String(publishedVersion.ordinal) })} · {(publishedVersion.sourceSize / (1024 * 1024)).toFixed(2)} MiB</p><ChartSummary summary={publishedVersion.summary} /></> : <p>{m.chart_metadata_unknown()}</p>}
        <SnapshotMetadata value={chart.publication} /></div> : null}
      <div className="space-y-2 rounded border p-3"><h3 className="font-semibold">{m.chart_metadata_selected_snapshot()}</h3>
      <p className="break-words font-semibold">{chart.title} · {chart.artist || "—"}</p>
      <p>{m.chart_version({ number: String(selected.ordinal) })} · {(selected.sourceSize / (1024 * 1024)).toFixed(2)} MiB</p>
      <ChartSummary summary={selected.summary} /><p className="text-sm">{m.author_advisory()}</p>
      <SnapshotMetadata value={{ ...chart, releaseNote: selected.releaseNote }} />
      <p className="text-xs text-muted-foreground">{m.chart_metadata_comparison_hint()}</p>
      <PrivateChartPreview key={selected.id} id={chart.id} versionId={selected.id} summary={selected.summary} />
    </div></div> : null}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={!interactive || busy || !selected || reconcile || uncertain} onChange={(event) => setConfirmed(event.target.checked)} />{m.chart_publication_archive()}</label>
    <div className="flex flex-wrap gap-2">
      <Button disabled={!interactive || busy || !selected || !confirmed || reconcile || uncertain} onClick={() => void mutate({ versionId, title: chart.title, artist: chart.artist, description: chart.description, credits: chart.credits, tags: chart.tags, releaseNote: selected?.releaseNote ?? "" })}>{chart.publication ? m.chart_publication_update() : m.chart_publication_confirm()}</Button>
      {chart.publication ? <Button variant="outline" disabled={!interactive || busy || reconcile || uncertain} onClick={() => setWithdrawing(true)}>{m.chart_publication_withdraw()}</Button> : null}
      {reconcile || uncertain ? <Button variant="outline" disabled={!interactive || busy} onClick={() => void check()}>{m.chart_publication_check()}</Button> : null}
    </div>
    {withdrawing ? <div role="alertdialog" aria-label={m.chart_publication_withdraw()} className="space-y-2 rounded border p-3">
      <p>{m.chart_publication_withdraw_hint()}</p>
      <Button disabled={!interactive || busy || reconcile || uncertain} onClick={() => void mutate(null)}>{m.chart_publication_withdraw_confirm()}</Button>{" "}
      <Button variant="outline" disabled={!interactive || busy} onClick={() => setWithdrawing(false)}>{m.avatar_cancel()}</Button>
    </div> : null}
    {status ? <p role="status">{status}</p> : null}
    {error ? <Alert role="alert" variant="destructive">{chartErrorMessage(error)}</Alert> : null}
  </section>;
}

function SnapshotMetadata({ value }: { value: { description: string; credits: string; tags: ChartDto["tags"]; releaseNote: string } }) {
  return <dl className="space-y-2 break-words text-sm"><div><dt>{m.chart_metadata_description()}</dt><dd className="whitespace-pre-wrap">{value.description || "—"}</dd></div><div><dt>{m.chart_metadata_credits()}</dt><dd className="whitespace-pre-wrap">{value.credits || "—"}</dd></div><div><dt>{m.chart_metadata_tags()}</dt><dd>{value.tags.map(tag => tag.label).join(" · ") || "—"}</dd></div><div><dt>{m.chart_metadata_release_note()}</dt><dd className="whitespace-pre-wrap">{value.releaseNote || "—"}</dd></div></dl>;
}
