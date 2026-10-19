import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { toast } from "@astrodx/ui/components/sonner";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useBeforeUnload, useBlocker, useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import { ApiError } from "@/shared/api-client";
import { chartPlainText, normalizeChartAliases, normalizeChartTags } from "@/shared/chart-metadata";
import type { ChartDto } from "@/shared/charts";
import { accountErrorRedirect } from "../lib/account-errors";
import { getBrowserApi } from "../lib/browser";
import { chartErrorMessage } from "../lib/chart-errors";
import { chartsApi } from "../queries/charts";

function fields(chart: ChartDto, versionId: string) {
  return { title: chart.title, artist: chart.artist, description: chart.description, credits: chart.credits,
    aliases: (chart.aliases??[]).join("\n"), tags: chart.tags.map(tag => tag.label).join("\n"), releaseNote: chart.versions.find(version => version.id === versionId)?.releaseNote ?? "" };
}
export function ChartMetadataEditor({ chart, busy, setBusy, refresh, onDirty }: {
  chart: ChartDto; busy: boolean; setBusy: (value: boolean) => void;
  refresh: (chart: ChartDto) => Promise<void>; onDirty: (value: boolean) => void;
}) {
  const location = useLocation();
  const [versionId, setVersionId] = useState(chart.currentVersionId);
  const [draft, setDraft] = useState(() => fields(chart, chart.currentVersionId));
  const [base, setBase] = useState(() => ({ revision: chart.revision, values: fields(chart, chart.currentVersionId) }));
  const [conflict, setConflict] = useState<ChartDto | null>(null);
  const [error, setError] = useState<unknown>();
  const dirty = JSON.stringify(draft) !== JSON.stringify(base.values);
  const blocker = useBlocker(dirty && !busy);
  useBeforeUnload(event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty && !chart.versions.some(version => version.id === versionId)) { setVersionId(chart.currentVersionId); return; }
    if (!dirty) { const values = fields(chart, versionId); setDraft(values); setBase({ revision: chart.revision, values }); }
  }, [chart, versionId, dirty]);
  async function save(event: FormEvent) {
    event.preventDefault(); setError(undefined);
    let tags: ReturnType<typeof normalizeChartTags>;let aliases:string[];
    try {
      if (!draft.title.trim() || [...draft.title.trim()].length > 120 || [...draft.artist.trim()].length > 120) throw new RangeError();
      chartPlainText(draft.description, 2000); chartPlainText(draft.credits, 1000); chartPlainText(draft.releaseNote, 1000);
      tags = normalizeChartTags(draft.tags.split("\n").filter(value => value.trim()));
      aliases=normalizeChartAliases(draft.aliases.split("\n").filter(value=>value.trim()));
    } catch { setError(new ApiError(422, "CHART_METADATA_INVALID", "Invalid metadata")); return; }
    const body = { expectedRevision: base.revision, title: draft.title.trim(), artist: draft.artist.trim(),
      description: draft.description, credits: draft.credits, aliases, tags: tags.map(tag => tag.label), releaseNote: { versionId, text: draft.releaseNote } };
    const api = chartsApi(getBrowserApi()); setBusy(true);
    const accept = async (actual: ChartDto) => {
      const values = fields(actual, versionId); setDraft(values); setBase({ revision: actual.revision, values }); setConflict(null);
      await refresh(actual); toast.success(m.chart_saved());
    };
    try { await accept(await api.patch(chart.id, body)); }
    catch (failure) {
      try {
        const actual = await api.get(chart.id), note = actual.versions.find(version => version.id === versionId)?.releaseNote;
        const matched = actual.title === body.title && actual.artist === body.artist && actual.description === body.description &&
          actual.credits === body.credits && JSON.stringify(actual.tags) === JSON.stringify(tags) && JSON.stringify(actual.aliases??[])===JSON.stringify(aliases) && note === body.releaseNote.text;
        if (matched && !(failure instanceof ApiError && failure.status < 500)) { await accept(actual); return; }
        // Keep the captured base revision until the user explicitly reviews this difference.
        setConflict(actual); await refresh(actual);
      } catch {}
      setError(failure);
      const redirect = accountErrorRedirect(failure, `${location.pathname}${location.search}`);
      if (redirect) window.location.assign(redirect);
    } finally { setBusy(false); }
  }
  function input(key: keyof typeof draft) { return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(value => ({ ...value, [key]: event.target.value })); }
  return <form onSubmit={save} className="space-y-3 rounded-lg border p-4">
    <h2 className="font-semibold">{m.chart_metadata_heading()}</h2><p className="text-sm text-muted-foreground">{m.chart_metadata_private_hint()}</p>
    <label className="block">{m.chart_title_label()}<input value={draft.title} maxLength={240} disabled={busy} onChange={input("title")} required className="mt-1 block w-full rounded border p-2" /></label>
    <label className="block">{m.chart_artist_label()}<input value={draft.artist} maxLength={240} disabled={busy} onChange={input("artist")} className="mt-1 block w-full rounded border p-2" /></label>
    <label className="block">{m.chart_metadata_description()}<textarea value={draft.description} maxLength={4000} disabled={busy} onChange={input("description")} rows={5} className="mt-1 block w-full rounded border p-2" /><span className="text-xs">{[...draft.description].length}/2000</span></label>
    <label className="block">{m.chart_metadata_credits()}<textarea value={draft.credits} maxLength={2000} disabled={busy} onChange={input("credits")} rows={3} className="mt-1 block w-full rounded border p-2" /><span className="text-xs">{[...draft.credits].length}/1000</span></label>
    <label className="block">{m.discovery_aliases()}<textarea value={draft.aliases} maxLength={2048} disabled={busy} onChange={input("aliases")} rows={3} className="mt-1 block w-full rounded border p-2"/><span className="text-xs text-muted-foreground">{m.discovery_alias_hint()}</span></label>
    <label className="block">{m.chart_metadata_tags()}<textarea value={draft.tags} disabled={busy} onChange={input("tags")} rows={3} className="mt-1 block w-full rounded border p-2" /></label><p className="text-xs text-muted-foreground">{m.chart_metadata_tags_hint()}</p>
    <label className="block">{m.chart_publication_version()}<select value={versionId} disabled={busy || dirty} onChange={event => setVersionId(event.target.value)} className="ml-2 rounded border p-2">{chart.versions.map(version => <option value={version.id} key={version.id}>{m.chart_version({ number: String(version.ordinal) })}</option>)}</select></label>
    <label className="block">{m.chart_metadata_release_note()}<textarea value={draft.releaseNote} maxLength={2000} disabled={busy} onChange={input("releaseNote")} rows={3} className="mt-1 block w-full rounded border p-2" /><span className="text-xs">{[...draft.releaseNote].length}/1000</span></label>
    {conflict ? <section role="alert" className="space-y-2 rounded border p-3">
      <p>{m.chart_metadata_conflict()}</p>
      <dl className="grid gap-2 sm:grid-cols-2">{(Object.keys(draft) as (keyof typeof draft)[]).filter(key => draft[key] !== fields(conflict, versionId)[key]).map(key => <div key={key} className="min-w-0 rounded border p-2"><dt>{({ title: m.chart_title_label(), artist: m.chart_artist_label(), description: m.chart_metadata_description(), credits: m.chart_metadata_credits(), tags: m.chart_metadata_tags(), aliases:m.discovery_aliases(), releaseNote: m.chart_metadata_release_note() })[key]}</dt><dd className="whitespace-pre-wrap break-words">{fields(conflict, versionId)[key] || "—"}</dd></div>)}</dl>
      <Button type="button" variant="outline" disabled={busy || !conflict.versions.some(version => version.id === versionId)} onClick={() => { setBase({ revision: conflict.revision, values: fields(conflict, versionId) }); setConflict(null); setError(undefined); }}>{m.chart_metadata_reviewed()}</Button>
    </section> : null}
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !dirty || !!conflict}>{busy ? m.chart_metadata_saving() : m.chart_metadata_save()}</Button>
      {dirty ? <Button type="button" variant="outline" disabled={busy} onClick={() => { const target = chart.versions.some(version => version.id === versionId) ? versionId : chart.currentVersionId; const values = fields(chart, target); setVersionId(target); setDraft(values); setBase({ revision: chart.revision, values }); setConflict(null); setError(undefined); }}>{m.chart_metadata_discard()}</Button> : null}</div>
    {error ? <Alert variant="destructive">{error instanceof ApiError && error.code === "CHART_METADATA_INVALID" ? m.chart_metadata_validation() : chartErrorMessage(error)}</Alert> : null}
    {blocker.state === "blocked" ? <div role="alertdialog" aria-label={m.chart_metadata_unsaved()} className="space-y-2 rounded border p-3"><p>{m.chart_metadata_unsaved()}</p><Button type="button" onClick={() => blocker.proceed()}>{m.chart_metadata_leave()}</Button>{" "}<Button type="button" variant="outline" onClick={() => blocker.reset()}>{m.avatar_cancel()}</Button></div> : null}
  </form>;
}
