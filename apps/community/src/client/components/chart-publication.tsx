import { ConfirmationDialog } from "@astrodx/ui/components/confirmation-dialog";
import { Badge } from "@astrodx/ui/components/badge";
import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { useEffect, useRef, useState } from "react";
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
import { ShareChartButton } from "./share-chart-button";

type Intent = { versionId: string; title: string; artist: string; description: string; credits: string; tags: ChartDto["tags"]; aliases?:string[]; releaseNote: string } | null;
function matches(chart: ChartDto, intent: Intent) {
  if (chart.publicationPending !== false) return false;
  return intent === null ? chart.publication === null : chart.publication?.versionId === intent.versionId &&
    chart.publication.title === intent.title && chart.publication.artist === intent.artist && chart.publication.description === intent.description && chart.publication.credits === intent.credits && JSON.stringify(chart.publication.tags) === JSON.stringify(intent.tags) && JSON.stringify(chart.publication.aliases??[])===JSON.stringify(intent.aliases??[]) && chart.publication.releaseNote === intent.releaseNote;
}
export function ChartPublication({ chart, busy, metadataUnsaved = false, setBusy, refresh, isCurrent = () => true }: {
  isCurrent?: () => boolean;
  chart: ChartDto; busy: boolean; metadataUnsaved?: boolean; setBusy: (busy: boolean) => void;
  refresh: (chart: ChartDto) => Promise<void>;
}) {
  const location = useLocation();
  const panel = useRef<HTMLElement>(null);
  const { hash, key } = location;
  useEffect(() => {
    if (hash === "#publication") {
      panel.current?.focus({ preventScroll: true });
      panel.current?.scrollIntoView({ block: "start" });
    }
  }, [hash, key]);
  const [interactive,setInteractive]=useState(false);
  useEffect(()=>setInteractive(true),[]);
  const fail = (error: unknown) => {
    if (!isCurrent()) return;
    const target = accountErrorRedirect(error, `${location.pathname}${location.search}`);
    if (target) window.location.assign(target);
  };
  const [choice, setChoice] = useState<{ versionId: string; currentVersionId: string } | null>(null);
  const chosenVersionId = choice?.currentVersionId === chart.currentVersionId ? choice.versionId : chart.currentVersionId;
  const selected = chart.versions.find((version) => version.id === chosenVersionId)
    ?? chart.versions.find((version) => version.id === chart.currentVersionId);
  const versionId = selected?.id ?? "";
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
  const privateChanges = !uncertain && chart.publication && (chart.currentVersionId !== chart.publication.versionId || chart.title !== chart.publication.title || chart.artist !== chart.publication.artist || chart.description !== chart.publication.description || chart.credits !== chart.publication.credits || JSON.stringify(chart.tags) !== JSON.stringify(chart.publication.tags) || JSON.stringify(chart.aliases??[])!==JSON.stringify(chart.publication.aliases??[]) || publishedVersion?.releaseNote !== chart.publication.releaseNote);
  const publicId = !uncertain && chart.publication ? chart.publicId ?? chart.id : null;
  const selectedFingerprint = fingerprints.key === fingerprintKey
    ? fingerprints.items.find((item) => item.versionId === versionId)
    : undefined;
  const packageComparison = fingerprints.key === fingerprintKey && fingerprints.items.length === 2
    ? compareFingerprints(fingerprints.items[0], fingerprints.items[1])
    : null;
  const api = chartsApi(getRenderApi());
  const accept = async (actual: ChartDto, target: Intent, allowSuccess: boolean) => {
    if (!isCurrent()) return false;
    await refresh(actual);
    if (!isCurrent()) return false;
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
      if (!isCurrent()) return;
      // A lost response can follow a committed mutation. Read before offering an explicit retry.
      setReconcile(true);
      try {
        const actual = await api.get(chart.id);
        const conflict = failure instanceof ApiError && failure.status < 500;
        if (await accept(actual, target, !conflict)) return;
      } catch { setStatus(m.chart_publication_pending()); }
      setError(failure); fail(failure);
    } finally { if (isCurrent()) setBusy(false); }
  }
  async function check() {
    setBusy(true); setError(undefined);
    try { await accept(await api.get(chart.id), intent, true); }
    catch (failure) { setError(failure); fail(failure); }
    finally { if (isCurrent()) setBusy(false); }
  }
  return <section ref={panel} tabIndex={-1} id="publication" aria-label={m.chart_publication()} className="community-panel space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="font-semibold">{m.chart_publication()}</h2>
      <a href={localizeHref("/help/publication")} className="inline-flex min-h-11 items-center text-sm underline">{m.site_help_publication_title()}</a>
      <Badge variant={uncertain ? "outline" : chart.publication ? "default" : "secondary"}>
        {uncertain ? m.chart_publication_status_pending() : chart.publication ? m.chart_publication_status_public() : m.chart_publication_status_private()}
      </Badge>
    </div>
    {metadataUnsaved ? <p role="status" className="text-sm">{m.chart_publication_save_metadata()}</p> : null}
    {chart.publication && !uncertain ? <div className="space-y-1 text-sm">
      <p>{m.chart_publication_current({ title: chart.publication.title, artist: chart.publication.artist })}</p>
      {publishedVersion ? <p>{m.chart_publication_published_version({ number: String(publishedVersion.ordinal) })}</p> : null}
    </div> : !uncertain ? <p>{m.chart_publication_private()}</p> : null}
    {privateChanges ? <p className="rounded-md border bg-muted/50 p-3 text-sm">{m.chart_publication_private_changes()}</p> : null}
    <label className="block">{m.chart_publication_version()}
      <select value={versionId} disabled={!interactive || busy || reconcile || uncertain} onChange={(event) => { setChoice({ versionId: event.target.value, currentVersionId: chart.currentVersionId }); setConfirmed(false); setStatus(""); }} className="ml-2 min-h-11 max-w-full rounded border p-2">
        {!selected ? <option value="" disabled>{m.chart_publication_choose()}</option> : null}
        {chart.versions.map((version) => <option key={version.id} value={version.id}>{m.chart_version({ number: String(version.ordinal) })}</option>)}
      </select>
    </label>
    {selected ? (
      <div className="space-y-3 rounded-md border p-3">
        <h3 className="font-semibold">{m.chart_metadata_selected_snapshot()}</h3>
        <p className="break-words font-semibold">{chart.title} · {chart.artist || "—"}</p>
        <p className="text-sm">{m.chart_publication_package({ size: (selected.sourceSize / (1024 * 1024)).toFixed(2) })}</p>
        <ChartSummary summary={selected.summary} />
        {selected.summary.warnings.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.chart_publication_no_warnings()}</p>
        ) : null}
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <Link className="underline" to={localizeHref(`/me/charts/${chart.id}/review?version=${selected.id}`)}>{m.author_review()}</Link>
          <Link className="underline" to={localizeHref(`/me/charts/${chart.id}/compare?right=${selected.id}${chart.publication ? `&left=${chart.publication.versionId}` : ""}`)}>{m.author_compare()}</Link>
        </div>
        <details className="community-source-details">
          <summary>{m.chart_metadata_heading()}</summary>
          <SnapshotMetadata value={{ ...chart, releaseNote: selected.releaseNote }} />
          {chart.publication ? <div className="space-y-2 border-t pt-3">
            <h4 className="font-semibold">{m.chart_metadata_current_snapshot()}</h4>
            <p className="break-words">{chart.publication.title} · {chart.publication.artist || "—"}</p>
            {publishedVersion ? <ChartSummary summary={publishedVersion.summary} /> : null}
            <SnapshotMetadata value={chart.publication} />
          </div> : null}
        </details>
        {selected.id !== chart.currentVersionId ? (
          <details className="community-source-details">
            <summary>{m.chart_preview()}</summary>
            <PrivateChartPreview key={selected.id} id={chart.id} versionId={selected.id} summary={selected.summary} />
          </details>
        ) : null}
        <details className="community-source-details">
          <summary>{m.author_package()}</summary>
          {fingerprints.key === fingerprintKey && fingerprints.error ? (
            <p>{m.author_analysis_failed()}</p>
          ) : selectedFingerprint ? (
            <>
              <p className="break-all font-mono text-xs">SHA256 {selectedFingerprint.source.sha256}</p>
              <ul className="space-y-1 text-sm">
                {([
                  ["maidata", m.chart_part_maidata()],
                  ["audio", m.chart_audio()],
                  ["cover", m.chart_cover()],
                ] as const).map(([role, label]) => {
                  const asset = selectedFingerprint.assets[role];
                  return asset ? <li key={role}>{label} · {asset.size} B</li> : null;
                })}
              </ul>
            </>
          ) : <p>{m.author_analysis_loading()}</p>}
          {packageComparison ? (
            <p>{packageComparison.archiveSame ? m.author_unchanged() : packageComparison.previewSame ? m.author_archive_changed() : m.author_different()}</p>
          ) : null}
        </details>
      </div>
    ) : null}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={!interactive || busy || !selected || reconcile || uncertain} onChange={(event) => setConfirmed(event.target.checked)} />{m.chart_publication_archive()}</label>
    <div className="flex flex-wrap gap-2">
      <Button disabled={!interactive || busy || !selected || !confirmed || reconcile || uncertain} onClick={() => void mutate({ versionId, title: chart.title, artist: chart.artist, description: chart.description, credits: chart.credits, tags: chart.tags, aliases:chart.aliases??[], releaseNote: selected?.releaseNote ?? "" })}>{chart.publication ? m.chart_publication_update() : m.chart_publication_confirm()}</Button>
      {chart.publication ? <Button variant="outline" disabled={!interactive || busy || reconcile || uncertain} onClick={() => setWithdrawing(true)}>{m.chart_publication_withdraw()}</Button> : null}
      {!withdrawing && (reconcile || uncertain) ? <Button variant="outline" disabled={!interactive || busy} onClick={() => void check()}>{m.chart_publication_check()}</Button> : null}
    </div>
    <ConfirmationDialog open={withdrawing} onOpenChange={setWithdrawing} title={m.chart_publication_withdraw()} description={m.chart_publication_withdraw_hint()} confirmLabel={m.chart_publication_withdraw_confirm()} cancelLabel={m.dash_cancel()} pending={!interactive || busy} confirmDisabled={reconcile || uncertain} fallbackFocus={() => document.getElementById("publication")} onConfirm={() => void mutate(null)}>
      {status ? <p role="status">{status}</p> : null}
      {error ? <Alert role="alert" variant="destructive">{chartErrorMessage(error)}</Alert> : null}
      {reconcile || uncertain ? <Button variant="outline" disabled={!interactive || busy} onClick={() => void check()}>{m.chart_publication_check()}</Button> : null}
    </ConfirmationDialog>
    {!withdrawing && status ? <p role="status">{status}</p> : null}
    {publicId ? (
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" className="min-h-11">
          <Link to={localizeHref(`/charts/${publicId}`)}>{m.chart_publication_view()}</Link>
        </Button>
        <ShareChartButton title={chart.publication?.title ?? chart.title} publicId={publicId} label={m.chart_publication_copy()} copyOnly />
      </div>
    ) : null}
    {!withdrawing && error ? <Alert role="alert" variant="destructive">{chartErrorMessage(error)}</Alert> : null}
  </section>;
}

function SnapshotMetadata({ value }: { value: { description: string; credits: string; tags: ChartDto["tags"]; aliases?:string[]; releaseNote: string } }) {
  return <dl className="space-y-2 break-words text-sm"><div><dt>{m.discovery_aliases()}</dt><dd>{(value.aliases??[]).join(" · ")||"—"}</dd></div><div><dt>{m.chart_metadata_description()}</dt><dd className="whitespace-pre-wrap">{value.description || "—"}</dd></div><div><dt>{m.chart_metadata_credits()}</dt><dd className="whitespace-pre-wrap">{value.credits || "—"}</dd></div><div><dt>{m.chart_metadata_tags()}</dt><dd>{value.tags.map(tag => tag.label).join(" · ") || "—"}</dd></div><div><dt>{m.chart_metadata_release_note()}</dt><dd className="whitespace-pre-wrap">{value.releaseNote || "—"}</dd></div></dl>;
}
