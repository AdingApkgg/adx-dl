import { ConfirmationDialog } from "@astrodx/ui/components/confirmation-dialog";
import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { ApiError } from "@/shared/api-client";
import { publicationConfirmationKey } from "../author/publication-review";
import type { ChartDto } from "@/shared/charts";
import { accountErrorRedirect } from "../lib/account-errors";
import { getRenderApi } from "../lib/browser";
import { chartErrorMessage } from "../lib/chart-errors";
import { chartsApi } from "../queries/charts";
import { ChartSummary, chartWarningMessage } from "./chart-summary";
import { PublicDifficultyPill } from "./public-chart-card";
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
  const heading = useRef<HTMLHeadingElement>(null);
  const withdrawTrigger = useRef<HTMLButtonElement>(null);
  const previousReview = useRef(false);
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
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const reviewing = reviewKey !== null;
  const reviewChanged = reviewing && reviewKey !== confirmationKey;
  function startReview() {
    setReviewKey(confirmationKey);
    setStatus("");
    setError(undefined);
  }
  const [withdrawing, setWithdrawing] = useState(false);
  const [reconcile, setReconcile] = useState(false);
  const [intent, setIntent] = useState<Intent>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<unknown>();
  const uncertain = reconcile || chart.publicationPending !== false;
  const showReview = reviewing && !uncertain;
  useEffect(() => {
    if (previousReview.current !== showReview) {
      heading.current?.focus({ preventScroll: true });
      previousReview.current = showReview;
    }
  }, [showReview]);
  const publishedVersion = chart.versions.find(version => version.id === chart.publication?.versionId);
  const privateChanges = !uncertain && chart.publication && (chart.currentVersionId !== chart.publication.versionId || chart.title !== chart.publication.title || chart.artist !== chart.publication.artist || chart.description !== chart.publication.description || chart.credits !== chart.publication.credits || JSON.stringify(chart.tags) !== JSON.stringify(chart.publication.tags) || JSON.stringify(chart.aliases??[])!==JSON.stringify(chart.publication.aliases??[]) || publishedVersion?.releaseNote !== chart.publication.releaseNote);
  const publicId = !uncertain && chart.publication ? chart.publicId ?? chart.id : null;
  const reviewHref = selected
    ? localizeHref(`/me/charts/${chart.id}/review?version=${selected.id}`)
    : null;
  const warning = selected?.summary.warnings[0];
  const api = chartsApi(getRenderApi());
  const accept = async (actual: ChartDto, target: Intent, allowSuccess: boolean) => {
    if (!isCurrent()) return false;
    await refresh(actual);
    if (!isCurrent()) return false;
    if (allowSuccess && matches(actual, target)) {
      setReconcile(false); setWithdrawing(false); setReviewKey(null);
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
  return <section ref={panel} tabIndex={-1} id="publication" aria-label={m.chart_publication()} className="community-panel community-publication space-y-4">
    <header className="community-publication-header flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b pb-3">
      <h2 ref={heading} tabIndex={-1} className="community-section-title">{showReview ? m.chart_publication_review_heading() : m.chart_publication_heading()}</h2>
      <span className="community-status community-publication-status">
        {uncertain ? m.chart_publication_status_pending() : chart.publication ? m.chart_publication_status_public() : m.chart_publication_status_private()}
      </span>
    </header>
    {metadataUnsaved ? <p role="status" className="text-sm">{m.chart_publication_save_metadata()}</p> : null}
    {chart.publication && !uncertain ? <div className="space-y-1 text-sm">
      <p className="break-words font-medium">
        {chart.publication.title}{chart.publication.artist ? ` · ${chart.publication.artist}` : ""}
      </p>
      {publishedVersion ? <p>{m.chart_publication_published_version({ number: String(publishedVersion.ordinal) })}</p> : null}
    </div> : null}
    {privateChanges ? <p className="community-publication-notice px-3 py-2 text-sm">{m.chart_publication_private_changes()}</p> : null}
    {showReview ? <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-36">
          <p className="break-words text-xl font-semibold leading-snug">{chart.title}</p>
          {chart.artist ? <p className="break-words text-sm text-muted-foreground">{chart.artist}</p> : null}
        </div>
        <label className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          {m.chart_publication_version()}
          <select
            value={versionId}
            disabled={!interactive || busy || uncertain}
            onChange={(event) => {
              setChoice({ versionId: event.target.value, currentVersionId: chart.currentVersionId });
              setReviewKey(publicationConfirmationKey(chart, event.target.value));
              setStatus("");
            }}
            className="community-publication-version min-h-11 max-w-full rounded-md border px-2"
          >
            {!selected ? <option value="" disabled>{m.chart_publication_choose()}</option> : null}
            {chart.versions.map((version) => <option key={version.id} value={version.id}>{m.chart_version({ number: String(version.ordinal) })}</option>)}
          </select>
        </label>
      </div>
      {selected ? <>
        <ul aria-label={m.chart_difficulties()} className="flex flex-wrap gap-1.5">
          {selected.summary.difficulties.map((difficulty) => (
            <li key={difficulty.difficulty} className="min-w-0">
              <PublicDifficultyPill row={difficulty} />
            </li>
          ))}
        </ul>
        {warning ? (
          <div className="community-publication-notice flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <p>{chartWarningMessage(warning.code)}</p>
            {reviewHref && selected.summary.warnings.length > 1 ? (
              <Link className="underline underline-offset-2" to={reviewHref}>
                {m.chart_publication_more_warnings({ count: String(selected.summary.warnings.length - 1) })}
              </Link>
            ) : null}
          </div>
        ) : null}
      </> : null}
    </div> : null}
    {showReview ? (
      <div className="community-publication-actions space-y-3 border-t pt-3">
        <p className="text-sm">{m.chart_publication_package()}</p>
        {reviewChanged ? <p role="status" className="text-sm">{m.chart_publication_changed()}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          {reviewChanged ? (
            <Button type="button" className="min-h-11" disabled={busy || !selected} onClick={startReview}>{m.chart_publication_review_again()}</Button>
          ) : (
            <Button type="button" className="min-h-11" disabled={!interactive || busy || !selected} onClick={() => void mutate({
              versionId, title: chart.title, artist: chart.artist, description: chart.description,
              credits: chart.credits, tags: chart.tags, aliases: chart.aliases ?? [], releaseNote: selected?.releaseNote ?? "",
            })}>{chart.publication ? m.chart_publication_update() : m.chart_publication_confirm()}</Button>
          )}
          <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setReviewKey(null)}>{m.dash_cancel()}</Button>
        </div>
      </div>
    ) : null}
    {!withdrawing && uncertain ? <Button variant="outline" disabled={!interactive || busy} onClick={() => void check()}>{m.chart_publication_check()}</Button> : null}
    <ConfirmationDialog open={withdrawing} onOpenChange={setWithdrawing} title={m.chart_publication_withdraw()} description={m.chart_publication_withdraw_hint()} confirmLabel={m.chart_publication_withdraw_confirm()} cancelLabel={m.dash_cancel()} pending={!interactive || busy} confirmDisabled={reconcile || uncertain} fallbackFocus={() => withdrawTrigger.current ?? panel.current} onConfirm={() => void mutate(null)}>
      {status ? <p role="status">{status}</p> : null}
      {error ? <Alert role="alert" variant="destructive">{chartErrorMessage(error)}</Alert> : null}
      {reconcile || uncertain ? <Button variant="outline" disabled={!interactive || busy} onClick={() => void check()}>{m.chart_publication_check()}</Button> : null}
    </ConfirmationDialog>
    {!withdrawing && status ? <p role="status">{status}</p> : null}
    {!reviewing && !uncertain ? (
      <div className="flex flex-wrap items-center gap-2">
        {publicId ? <>
          <Button asChild className="min-h-11">
            <Link to={localizeHref(`/charts/${publicId}`)}>{m.chart_publication_view()}</Link>
          </Button>
          <ShareChartButton title={chart.publication?.title ?? chart.title} publicId={publicId} label={m.chart_publication_copy()} copyOnly />
        </> : <p className="basis-full text-sm text-muted-foreground">{m.chart_publication_draft_summary()}</p>}
        <Button type="button" variant={publicId ? "outline" : "default"} className="min-h-11" disabled={!interactive || busy || !selected} onClick={startReview}>
          {publicId ? m.chart_publication_update_review() : m.chart_publication_review()}
        </Button>
        {publicId ? <Button ref={withdrawTrigger} type="button" variant="outline" className="min-h-11" disabled={!interactive || busy} onClick={() => setWithdrawing(true)}>{m.chart_publication_withdraw()}</Button> : null}
      </div>
    ) : null}
    {!withdrawing && error ? <Alert role="alert" variant="destructive">{chartErrorMessage(error)}</Alert> : null}
    {showReview && selected ? (
      <details className="community-source-details">
        <summary>{m.chart_metadata_heading()}</summary>
        <ChartSummary summary={selected.summary} />
        <SnapshotMetadata value={{ ...chart, releaseNote: selected.releaseNote }} />
        {chart.publication ? <div className="space-y-2 border-t pt-3">
          <h3 className="font-semibold">{m.chart_metadata_current_snapshot()}</h3>
          <p className="break-words">{chart.publication.title} · {chart.publication.artist || "—"}</p>
          {publishedVersion ? <ChartSummary summary={publishedVersion.summary} /> : null}
          <SnapshotMetadata value={chart.publication} />
        </div> : null}
        {selected.id !== chart.currentVersionId ? (
          <PrivateChartPreview key={selected.id} id={chart.id} versionId={selected.id} summary={selected.summary} />
        ) : null}
        <Link className="community-inline-action" to={localizeHref(`/me/charts/${chart.id}/compare?right=${selected.id}${chart.publication ? `&left=${chart.publication.versionId}` : ""}`)}>{m.author_compare()}</Link>
      </details>
    ) : null}
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {showReview && reviewHref ? <Link className="community-inline-action" to={reviewHref}>{m.author_review()}</Link> : null}
      <Link className="community-inline-action" to={localizeHref("/help/publication")}>{m.site_help_publication_title()}</Link>
    </div>
  </section>;
}

function SnapshotMetadata({ value }: { value: { description: string; credits: string; tags: ChartDto["tags"]; aliases?:string[]; releaseNote: string } }) {
  return <dl className="space-y-2 break-words text-sm"><div><dt>{m.discovery_aliases()}</dt><dd>{(value.aliases??[]).join(" · ")||"—"}</dd></div><div><dt>{m.chart_metadata_description()}</dt><dd className="whitespace-pre-wrap">{value.description || "—"}</dd></div><div><dt>{m.chart_metadata_credits()}</dt><dd className="whitespace-pre-wrap">{value.credits || "—"}</dd></div><div><dt>{m.chart_metadata_tags()}</dt><dd>{value.tags.map(tag => tag.label).join(" · ") || "—"}</dd></div><div><dt>{m.chart_metadata_release_note()}</dt><dd className="whitespace-pre-wrap">{value.releaseNote || "—"}</dd></div></dl>;
}
