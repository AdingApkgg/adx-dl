import {ShareChartButton} from "./share-chart-button";
import {previewShareParams} from "@/shared/discovery-search";
import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { MaximizeIcon, MinimizeIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { m } from "@/paraglide/messages.js";
import type { MirrorMode, Note } from "@lxns-network/maimai-chart-engine";
import type { ChartDifficulty, ChartImportSummary } from "@/shared/charts";

import { chartErrorMessage } from "../lib/chart-errors";
import { accountErrorRedirect } from "../lib/account-errors";
import { PREVIEW_RATES, previewTime } from "../lib/chart-preview-controls";
import { createPreviewPlayer, type PreviewPlayer } from "../lib/chart-preview-player";
import { gifFrameCount, initialPreviewRange, normalizePreviewRange, type PreviewRange } from "../lib/chart-preview-practice";
import { PreviewTimeline } from "./preview-timeline";
import { chartAssetUrl } from "../queries/charts";
import { publicDifficultyName } from "./public-chart-card";

type Props = {
  id: string; versionId: string; summary: ChartImportSummary; assetUrl?: typeof chartAssetUrl; sectionId?: string;
  enableShare?:boolean; initialDifficulty?:ChartDifficulty; controlledDifficulty?: ChartDifficulty; externalSeek?: {token:number;seconds:number}|null; initialPosition?: number; onPosition?: (seconds:number)=>void;
};
export function PrivateChartPreview(props: Props) {
  return <ChartPreview key={`${props.id}/${props.versionId}`} {...props} />;
}
function ChartPreview({ id, versionId, summary, assetUrl = chartAssetUrl, sectionId, enableShare=false, initialDifficulty, controlledDifficulty, externalSeek, initialPosition = 0, onPosition }: Props) {
  const previewTitle = assetUrl === chartAssetUrl ? m.chart_preview() : m.public_chart_preview();
  const [difficulty, setDifficulty] = useState<ChartDifficulty | undefined>(() => controlledDifficulty ?? initialDifficulty ?? summary.difficulties.find(row => row.previewSupported)?.difficulty);
  const [opened, setOpened] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [silent, setSilent] = useState(!summary.audio);
  const [error, setError] = useState<unknown>();
  const [coverFailed, setCoverFailed] = useState(false);
  const [position, setPosition] = useState(0);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const settings = useRef({ rate: 1, volume: 0.8, muted: false, mirror: "none" as MirrorMode });
  const [mirror, setMirror] = useState<MirrorMode>("none");
  const [notes, setNotes] = useState<readonly Note[]>([]);
  const [range, setRange] = useState<PreviewRange | null>(null);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportState, setExportState] = useState<"idle" | "cancelled" | "failed" | "done">("idle");
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const exportJob = useRef<AbortController | null>(null);
  const downloadUrl = useRef<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [fullscreenPending, setFullscreenPending] = useState(false);
  const [fullscreenFailed, setFullscreenFailed] = useState(false);
  const section = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<PreviewPlayer | null>(null);
  const duration = (summary.difficulties.find(row => row.difficulty === difficulty)?.durationMs ?? 0) / 1000;

  const positionCallback = useRef(onPosition); positionCallback.current = onPosition;
  const initialSeek = useRef(initialPosition);
  const appliedExternalSeek = useRef<number|null>(null);
  const discussionSeek = useRef<{ difficulty: ChartDifficulty; ms: number } | null>(null);
  useEffect(() => {
    if (!externalSeek || appliedExternalSeek.current===externalSeek.token || !difficulty || exporting || !Number.isFinite(externalSeek.seconds) || externalSeek.seconds < 0 || externalSeek.seconds > duration) return;
    appliedExternalSeek.current=externalSeek.token;
    player.current?.pause(); setRange(null);setLoopEnabled(false);player.current?.setRange(null,false);
    if(opened && ready && player.current){player.current.seek(externalSeek.seconds);discussionSeek.current=null;}
    else{discussionSeek.current={difficulty,ms:externalSeek.seconds*1000};setOpened(true);}
  }, [externalSeek, difficulty, exporting, duration, opened, ready]);
  useEffect(() => {
    if (assetUrl === chartAssetUrl) return;
    const seek = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; versionId: string; difficulty: ChartDifficulty; ms: number }>).detail;
      if (!detail || detail.id !== id || detail.versionId !== versionId || exporting) return;
      const row = summary.difficulties.find(row => row.difficulty === detail.difficulty);
      if (!row?.previewSupported || row.durationMs === null || !Number.isSafeInteger(detail.ms) || detail.ms < 0 || detail.ms > row.durationMs) return;
      player.current?.pause(); setRange(null); setLoopEnabled(false); player.current?.setRange(null, false);
      if (opened && ready && difficulty === detail.difficulty && player.current) {
        player.current.seek(detail.ms / 1000); discussionSeek.current = null;
      } else { discussionSeek.current = { difficulty: detail.difficulty, ms: detail.ms }; setReady(false); setDifficulty(detail.difficulty); setOpened(true); }
      section.current?.scrollIntoView({ block: "start", behavior: "smooth" }); section.current?.focus({ preventScroll: true });
    };
    const positionRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; versionId: string; difficulty: ChartDifficulty; requestId: string }>).detail;
      if (!detail || typeof detail.requestId !== "string" || detail.requestId.length > 128 || detail.id !== id || detail.versionId !== versionId || detail.difficulty !== difficulty || !opened || !ready || !player.current) return;
      const row = summary.difficulties.find(row => row.difficulty === difficulty);
      if (!row?.previewSupported || row.durationMs === null) return;
      const ms = Math.round(player.current.position() * 1000);
      if (Number.isSafeInteger(ms) && ms >= 0 && ms <= row.durationMs) window.dispatchEvent(new CustomEvent("community-preview-position", { detail: { id, versionId, difficulty, ms, requestId: detail.requestId } }));
    };
    window.addEventListener("community-preview-seek", seek); window.addEventListener("community-preview-position-request", positionRequest);
    return () => { window.removeEventListener("community-preview-seek", seek); window.removeEventListener("community-preview-position-request", positionRequest); };
  }, [id, versionId, summary, assetUrl, difficulty, exporting, opened, ready]);

  useEffect(() => {
    const element = section.current;
    setFullscreenSupported(Boolean(element?.requestFullscreen) && document.fullscreenEnabled !== false);
    const changed = () => setFullscreen(document.fullscreenElement === element);
    document.addEventListener("fullscreenchange", changed);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      if (element && document.fullscreenElement === element) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  async function toggleFullscreen() {
    if (!section.current || fullscreenPending) return;
    setFullscreenPending(true); setFullscreenFailed(false);
    try {
      if (document.fullscreenElement === section.current) await document.exitFullscreen();
      else await section.current.requestFullscreen();
    } catch { setFullscreenFailed(true); }
    finally { setFullscreenPending(false); }
  }
  function closePreview() {
    discussionSeek.current = null;
    player.current?.pause(); player.current?.dispose(); cancelExport(); clearDownload();
    setRange(null); setLoopEnabled(false); setReady(false); setOpened(false);
    settings.current.mirror = "none"; setMirror("none");
    if (document.fullscreenElement === section.current) void document.exitFullscreen().catch(() => {});
  }
  function changeRate(value: number) {
    if (!PREVIEW_RATES.some(rate => rate === value)) return;
    settings.current.rate = value; setRate(value); player.current?.setRate(value);
  }
  function changeVolume(value: number) {
    const next = Math.max(0, Math.min(1, value));
    settings.current.volume = next; settings.current.muted = next === 0;
    setVolume(next); setMuted(next === 0); player.current?.setVolume(next);
  }
  function toggleMuted() {
    const next = !settings.current.muted;
    if (!next && settings.current.volume === 0) { settings.current.volume = 0.8; setVolume(0.8); }
    settings.current.muted = next; setMuted(next);
    player.current?.setVolume(next ? 0 : settings.current.volume);
  }
  function shortcuts(event: KeyboardEvent<HTMLElement>) {
    if (!opened || !ready || exporting || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("input,select,textarea,button,a,summary,[contenteditable]:not([contenteditable='false']),[role='button'],[role='slider'],[role='textbox']")) return;
    if (event.key === " ") {
      event.preventDefault(); if (!event.repeat) { if (playing) player.current?.pause(); else void player.current?.play(); }
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault(); player.current?.seekBy(event.key === "ArrowRight" ? 5 : -5);
    } else if (event.key === "Home") { event.preventDefault(); player.current?.seek(0); }
  }

  function clearDownload() {
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    downloadUrl.current = null; setDownload(null);
  }
  function cancelExport() { exportJob.current?.abort(); }
  function updateRange(value: PreviewRange | null, enabled = loopEnabled) {
    const next = value ? normalizePreviewRange(value, duration) : null;
    setRange(next); setLoopEnabled(Boolean(next && enabled));
    player.current?.setRange(next, Boolean(next && enabled));
  }
  function setPoint(point: "a" | "b") {
    const at = player.current?.position() ?? position;
    const current = range ?? initialPreviewRange(point === "b" ? Math.max(0, at - 8) : at, duration);
    if (current) updateRange(point === "a" ? { ...current, start: at } : { ...current, end: at });
  }
  function changeMirror(value: MirrorMode) {
    settings.current.mirror = value; setMirror(value); player.current?.setMirror(value);
  }
  async function startExport() {
    if (!range || !ready || exportJob.current || !player.current) return;
    try { gifFrameCount(range, duration); } catch { return; }
    const job = new AbortController(); exportJob.current = job;
    setExporting(true); setExportProgress(0); setExportState("idle"); clearDownload();
    try {
      const blob = await player.current.exportGif({ ...range }, job.signal, value => {
        if (exportJob.current === job && !job.signal.aborted) setExportProgress(value);
      });
      if (exportJob.current !== job || job.signal.aborted) return;
      const numericId = assetUrl !== chartAssetUrl && /^[1-9]\d{0,19}$/.test(id) ? `-${id}` : "";
      const name = `chart${numericId}-d${difficulty}-${Math.round(range.start * 1000)}-${Math.round(range.end * 1000)}.gif`;
      const url = URL.createObjectURL(blob); downloadUrl.current = url; setDownload({ url, name });
      setExportState("done");
      const link = document.createElement("a"); link.href = url; link.download = name;
      document.body.append(link); link.click(); link.remove();
    } catch {
      if (exportJob.current === job) setExportState(job.signal.aborted ? "cancelled" : "failed");
    } finally {
      if (exportJob.current === job) { exportJob.current = null; setExporting(false); }
    }
  }
  let gifAllowed = false;
  if (range) { try { gifFrameCount(range, duration); gifAllowed = true; } catch {} }
  const mirrors: [MirrorMode, string][] = [["none", m.chart_preview_mirror_none()], ["horizontal", m.chart_preview_mirror_h()],
    ["vertical", m.chart_preview_mirror_v()], ["rotate180", m.chart_preview_mirror_180()]];

  useEffect(() => {
    if (!opened || !difficulty || !canvas.current) return;
    setReady(false); setPlaying(false); setSilent(!summary.audio); setError(undefined); setCoverFailed(false); setPosition(0);
    setNotes([]); setRange(null); setLoopEnabled(false); setExporting(false); setExportState("idle");
    const controller = createPreviewPlayer({
      id, versionId, difficulty, duration, summary, canvas: canvas.current, assetUrl,
      rate: settings.current.rate, volume: settings.current.muted ? 0 : settings.current.volume, mirror: settings.current.mirror,
      onReady: value => {
        setReady(value); const target = discussionSeek.current ?? (initialSeek.current > 0 && difficulty ? {difficulty,ms:initialSeek.current*1000} : null);
        if(value) initialSeek.current=0;
        if (value && target?.difficulty === difficulty && player.current) { player.current.pause(); player.current.setRange(null, false); player.current.seek(Math.max(0,Math.min(duration,target.ms / 1000))); discussionSeek.current = null; }
      }, onPlaying: setPlaying, onPosition: seconds => {setPosition(seconds);positionCallback.current?.(seconds);}, onNotes: setNotes,
      onSilent: () => setSilent(true), onCoverFailed: () => setCoverFailed(true), onLoopDisabled: () => setLoopEnabled(false),
      onError: failure => {
        discussionSeek.current = null;
        setPlaying(false); setError(failure);
        const target = assetUrl === chartAssetUrl ? accountErrorRedirect(failure, `${window.location.pathname}${window.location.search}`) : null;
        if (target) window.location.assign(target);
      },
    });
    player.current = controller;
    return () => {
      controller.dispose(); player.current = null;
      exportJob.current?.abort(); exportJob.current = null;
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      downloadUrl.current = null;
    };
  }, [id, versionId, difficulty, opened, duration, summary, assetUrl]);
  // Revoke rendered download links when a new preview lifetime starts; cleanup above owns the actual URL.
  useEffect(() => { setDownload(null); }, [difficulty, opened, id, versionId, assetUrl]);
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: A focusable preview region scopes its documented keyboard shortcuts.
    <section ref={section} id={sectionId} tabIndex={0} onKeyDown={shortcuts} aria-label={previewTitle}
    className={`scroll-mt-24 space-y-3 rounded-lg border bg-background p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${fullscreen ? "h-dvh overflow-y-auto" : ""}`}>
    <h2 className="font-semibold">{previewTitle}</h2>
    <p className="text-sm text-muted-foreground">{m.chart_preview_hint()}</p>
    <label className="block text-sm">{m.chart_difficulties()}
      <select value={difficulty ?? ""} disabled={exporting || controlledDifficulty !== undefined} onChange={event => {initialSeek.current=0;setDifficulty(Number(event.target.value) as ChartDifficulty);}} className="ml-2 min-h-11 rounded border bg-background px-2 py-1">
        {!difficulty ? <option value="">{m.chart_unsupported()}</option> : null}
        {summary.difficulties.map(row => <option key={row.difficulty} value={row.difficulty} disabled={!row.previewSupported}>
          {publicDifficultyName(row.difficulty)}{row.previewSupported ? "" : ` · ${m.chart_unsupported()}`}
        </option>)}
      </select>
    </label>
    {!opened ? <Button className="min-h-11" disabled={!difficulty || !summary.difficulties.find(d=>d.difficulty===difficulty)?.previewSupported} onClick={() => setOpened(true)}>{m.chart_preview_load()}</Button> : <>
      <div className={`mx-auto aspect-square w-full bg-black ${fullscreen ? "max-w-[min(65dvh,100%)]" : "max-w-lg"}`}><canvas ref={canvas} aria-label={previewTitle} className="h-full w-full" /></div>
      {!ready && !error ? <p role="status">{m.chart_preview_loading()}</p> : null}
      {silent ? <p role="status" className="text-sm">{m.chart_preview_silent()}</p> : null}
      {coverFailed ? <p role="status" className="text-sm">{m.chart_preview_cover_failed()}</p> : null}
      <div role="group" aria-label={m.chart_preview_controls()} className="flex flex-wrap items-center gap-2">
        <Button className="min-h-11" disabled={!ready || exporting} onClick={() => playing ? player.current?.pause() : void player.current?.play()}>{playing ? m.chart_pause() : m.chart_play()}</Button>
        <Button variant="outline" className="min-h-11" onClick={closePreview}>{m.chart_close()}</Button>
        <span className="text-sm tabular-nums">{previewTime(position)} / {previewTime(duration)}</span>
        {fullscreenSupported ? <Button type="button" variant="outline" className="min-h-11" disabled={fullscreenPending} onClick={() => void toggleFullscreen()}>
          {fullscreen ? <MinimizeIcon aria-hidden="true" /> : <MaximizeIcon aria-hidden="true" />}{fullscreen ? m.chart_preview_exit_fullscreen() : m.chart_preview_fullscreen()}
        </Button> : null}
      </div>
      <PreviewTimeline notes={notes} duration={duration} position={position} range={range} disabled={!ready || exporting}
        onSeek={seconds => player.current?.seek(seconds)} onRange={value => updateRange(value)} />
      <div role="group" aria-label={m.chart_preview_practice()} className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" className="min-h-11" disabled={!ready || exporting || duration <= 0} onClick={() => setPoint("a")}>{m.chart_preview_set_a()}</Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={!ready || exporting || duration <= 0} onClick={() => setPoint("b")}>{m.chart_preview_set_b()}</Button>
        <Button type="button" variant={loopEnabled ? "default" : "outline"} className="min-h-11" aria-pressed={loopEnabled} disabled={!ready || exporting || duration <= 0}
          onClick={() => updateRange(range ?? initialPreviewRange(player.current?.position() ?? position, duration), !loopEnabled)}>{m.chart_preview_loop()}</Button>
        <Button type="button" variant="ghost" className="min-h-11" disabled={!range || exporting} onClick={() => updateRange(null, false)}>{m.chart_preview_clear_range()}</Button>
      </div>
      {loopEnabled ? <p role="status" className="text-sm">{m.chart_preview_loop_active()}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">{m.chart_preview_rate()}
          <select value={rate} disabled={exporting} onChange={event => changeRate(Number(event.target.value))} className="min-h-11 rounded border bg-background px-2">
            {PREVIEW_RATES.map(rate => <option key={rate} value={rate}>{rate}×</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">{m.chart_preview_mirror()}
          <select value={mirror} disabled={exporting} onChange={event => changeMirror(event.target.value as MirrorMode)} className="min-h-11 rounded border bg-background px-2">
            {mirrors.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <Button type="button" variant="outline" className="min-h-11" aria-pressed={muted} disabled={silent} onClick={toggleMuted} aria-label={muted ? m.chart_preview_unmute() : m.chart_preview_mute()}>
          {muted ? <VolumeXIcon aria-hidden="true" /> : <Volume2Icon aria-hidden="true" />}
        </Button>
        <label className="flex min-w-0 flex-1 basis-40 items-center gap-2 text-sm">{m.chart_preview_volume()}
          <input type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume} disabled={silent} className="min-h-11 w-full min-w-0" onChange={event => changeVolume(Number(event.target.value))} />
        </label>
      </div>
      <div className="space-y-2 rounded border p-3">
        <p className="text-sm text-muted-foreground">{m.chart_preview_export_hint()}</p>
        <Button type="button" variant="outline" className="min-h-11" disabled={!ready || exporting || !gifAllowed} onClick={() => void startExport()}>{m.chart_preview_export()}</Button>
        {range && !gifAllowed ? <p role="status" className="text-sm">{m.chart_preview_export_range_hint()}</p> : null}
        {!range ? <p className="text-xs text-muted-foreground">{m.chart_preview_export_select()}</p> : null}
        {exporting ? <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">{m.chart_preview_export_progress()}<progress max={1} value={exportProgress} />{Math.round(exportProgress * 100)}%</label>
          <Button type="button" variant="outline" className="min-h-11" onClick={cancelExport}>{m.chart_preview_export_cancel()}</Button>
        </div> : null}
        {exportState === "cancelled" ? <p role="status">{m.chart_preview_export_cancelled()}</p> : null}
        {exportState === "failed" ? <p role="alert">{m.chart_preview_export_failed()}</p> : null}
        {download ? <a href={download.url} download={download.name} className="inline-flex min-h-11 items-center underline">{m.chart_preview_export_download()}</a> : null}
      </div>
      {enableShare&&assetUrl!==chartAssetUrl&&/^[1-9]\d{0,18}$/.test(id)&&difficulty?<ShareChartButton title={summary.title} publicId={id} searchParams={previewShareParams({difficulty,seconds:position}).toString()} label={m.discovery_share_position()}/>:null}
      <p className="text-xs text-muted-foreground">{m.chart_preview_shortcuts()}</p>
      {rate !== 1 ? <p className="text-xs text-muted-foreground">{m.chart_preview_rate_pitch()}</p> : null}
    </>}
    {fullscreenFailed ? <p role="status" className="text-sm text-muted-foreground">{m.chart_preview_fullscreen_failed()}</p> : null}
    {error ? <Alert role="alert" variant="destructive">{assetUrl === chartAssetUrl ? chartErrorMessage(error) : m.public_chart_unavailable()}</Alert> : null}
  </section>);
}
