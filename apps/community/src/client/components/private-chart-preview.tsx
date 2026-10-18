import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { MaximizeIcon, MinimizeIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { m } from "@/paraglide/messages.js";
import { ApiError, expectOk } from "@/shared/api-client";
import type { ChartDifficulty, ChartImportSummary } from "@/shared/charts";
import { normalizeChartMaidata } from "@/shared/charts-maidata";
import { chartErrorMessage } from "../lib/chart-errors";
import { accountErrorRedirect } from "../lib/account-errors";
import { PREVIEW_RATES, previewAudioStart, previewPosition, previewTime } from "../lib/chart-preview-controls";
import { chartAssetUrl } from "../queries/charts";
import { publicDifficultyName } from "./public-chart-card";

type Player = {
  play(): Promise<void>; pause(): void; seek(seconds: number): void; seekBy(seconds: number): void;
  setRate(rate: number): void; setVolume(volume: number): void; dispose(): void;
};
export function PrivateChartPreview({ id, versionId, summary, assetUrl = chartAssetUrl, sectionId }: {
  id: string; versionId: string; summary: ChartImportSummary; assetUrl?: typeof chartAssetUrl; sectionId?: string;
}) {
  const previewTitle = assetUrl === chartAssetUrl ? m.chart_preview() : m.public_chart_preview();
  const [difficulty, setDifficulty] = useState<ChartDifficulty | undefined>(() => summary.difficulties.find(row => row.previewSupported)?.difficulty);
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
  const settings = useRef({ rate: 1, volume: 0.8, muted: false });
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [fullscreenPending, setFullscreenPending] = useState(false);
  const [fullscreenFailed, setFullscreenFailed] = useState(false);
  const section = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<Player | null>(null);
  const duration = (summary.difficulties.find(row => row.difficulty === difficulty)?.durationMs ?? 0) / 1000;

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
    player.current?.pause(); setOpened(false);
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
    if (!opened || !ready || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("input,select,textarea,button,a,summary,[contenteditable]:not([contenteditable='false']),[role='button'],[role='slider'],[role='textbox']")) return;
    if (event.key === " ") {
      event.preventDefault(); if (!event.repeat) { if (playing) player.current?.pause(); else void player.current?.play(); }
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault(); player.current?.seekBy(event.key === "ArrowRight" ? 5 : -5);
    } else if (event.key === "Home") { event.preventDefault(); player.current?.seek(0); }
  }

  useEffect(() => {
    if (!opened || !difficulty || !canvas.current) return;
    const aborter = new AbortController();
    let disposed = false;
    let context: AudioContext | undefined;
    let gain: GainNode | undefined;
    let source: AudioBufferSourceNode | undefined;
    let decoded: AudioBuffer | undefined;
    let audio: ArrayBuffer | undefined;
    let preparingAudio: Promise<void> | undefined;
    let frame = 0, time = 0, started = 0, anchor = 0, lastPositionUpdate = 0;
    let running = false, wantsToPlay = false, playbackGeneration = 0;
    let speed = settings.current.rate;
    let level = settings.current.muted ? 0 : settings.current.volume;
    let coverUrl: string | undefined;
    let resize: ResizeObserver | undefined;
    let renderer: import("@lxns-network/maimai-chart-engine").MainRenderer | undefined;
    setReady(false); setPlaying(false); setSilent(!summary.audio); setError(undefined); setCoverFailed(false); setPosition(0);
    const clock = () => context ? context.currentTime : performance.now() / 1000;
    const currentTime = () => running ? previewPosition(anchor, clock() - started, speed, duration) : time;
    const stopSource = () => { try { source?.stop(); } catch {} source?.disconnect(); source = undefined; };
    const closeAudio = () => { stopSource(); gain?.disconnect(); gain = undefined; void context?.close().catch(() => {}); context = undefined; decoded = undefined; };
    const cleanup = () => {
      if (disposed) return;
      disposed = true; wantsToPlay = false; ++playbackGeneration; aborter.abort(); cancelAnimationFrame(frame); closeAudio(); resize?.disconnect();
      renderer?.setIsPlaying(false); renderer?.setBackgroundImage(null);
      if (coverUrl) URL.revokeObjectURL(coverUrl);
      audio = undefined;
    };
    void (async () => {
      const engine = await import("@lxns-network/maimai-chart-engine");
      const maidata = await (await expectOk(await fetch(assetUrl(id, versionId, "maidata"), { signal: aborter.signal, cache: "no-store" }))).arrayBuffer();
      if (disposed) return;
      const chart = engine.parseSimaiChart(normalizeChartMaidata(new TextDecoder("utf-8", { fatal: true }).decode(maidata)).text, difficulty, { maxNotes: 100000, maxDurationMs: 3600000 });
      const timeline = engine.TimingTimeline.fromChart(chart);
      renderer = new engine.MainRenderer(canvas.current!, { sensorImagePath: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", showStatistics: false });
      renderer.setJudgmentLineDesign("simple");
      const render = () => renderer?.renderFrame(chart, timeline.beatFromMs(time * 1000), 4);
      render();
      resize = new ResizeObserver(() => { renderer?.resize(); render(); }); resize.observe(canvas.current!.parentElement!);
      const tick = () => {
        if (disposed || !running) return;
        time = currentTime(); render();
        const now = performance.now();
        if (now - lastPositionUpdate >= 200 || time >= duration) { lastPositionUpdate = now; setPosition(time); }
        if (time >= duration) { running = false; wantsToPlay = false; stopSource(); renderer?.setIsPlaying(false); setPlaying(false); }
        else frame = requestAnimationFrame(tick);
      };
      const startSource = () => {
        if (!decoded || !context || !gain) return;
        const { delay, offset } = previewAudioStart(time, chart.bpm, chart.firstMs ?? 0, speed);
        if (offset >= decoded.duration) return;
        source = context.createBufferSource(); source.buffer = decoded; source.playbackRate.value = speed; source.connect(gain);
        source.start(context.currentTime + delay, offset);
      };
      const prepareAudio = () => {
        if (!preparingAudio && audio) preparingAudio = (async () => {
          context = new AudioContext(); gain = context.createGain(); gain.gain.value = level; gain.connect(context.destination);
          await context.resume();
          if (disposed || !audio) return;
          const bytes = audio; audio = undefined;
          const buffer = await context.decodeAudioData(bytes);
          if (!disposed) decoded = buffer;
        })().catch(() => { closeAudio(); audio = undefined; if (!disposed) setSilent(true); });
        return preparingAudio ?? Promise.resolve();
      };
      const pause = () => {
        ++playbackGeneration; wantsToPlay = false; time = currentTime(); running = false;
        cancelAnimationFrame(frame); stopSource(); renderer?.setIsPlaying(false);
        if (!disposed) { setPlaying(false); setPosition(time); render(); }
      };
      const controller: Player = {
        async play() {
          if (disposed || running) return;
          wantsToPlay = true;
          const generation = ++playbackGeneration;
          if (time >= duration) time = 0;
          await prepareAudio();
          if (disposed || generation !== playbackGeneration || !wantsToPlay) return;
          if (context) {
            try { await context.resume(); }
            catch { closeAudio(); if (!disposed) setSilent(true); }
          }
          if (disposed || generation !== playbackGeneration || !wantsToPlay) return;
          anchor = time; started = clock(); running = true;
          renderer?.setIsPlaying(true); startSource(); setPlaying(true); frame = requestAnimationFrame(tick);
        },
        pause,
        seek(seconds) {
          if (disposed || !Number.isFinite(seconds)) return;
          const resume = wantsToPlay; pause(); time = Math.max(0, Math.min(duration, seconds)); render(); setPosition(time);
          if (resume && time < duration) void controller.play();
        },
        seekBy(seconds) { controller.seek(currentTime() + seconds); },
        setRate(value) {
          if (disposed || !PREVIEW_RATES.some(rate => rate === value)) return;
          const resume = wantsToPlay; pause(); speed = value;
          if (resume) void controller.play();
        },
        setVolume(value) { level = value; if (gain) gain.gain.value = value; },
        dispose: cleanup,
      };
      // Controls are available while import/maidata is pending; initialize from their latest values.
      speed = settings.current.rate;
      level = settings.current.muted ? 0 : settings.current.volume;
      player.current = controller;
      // The resolver selects one authorization boundary; failures never fall back to another route.
      if (summary.hasCover) {
        try {
          const blob = await (await expectOk(await fetch(assetUrl(id, versionId, "cover"), { signal: aborter.signal, cache: "no-store" }))).blob();
          if (disposed) return;
          coverUrl = URL.createObjectURL(blob);
          const image = new Image(); image.src = coverUrl;
          await image.decode(); if (disposed) return; renderer.setBackgroundImage(image); render();
        } catch (failure) {
          if (disposed) return;
          if (failure instanceof ApiError && failure.status < 500) throw failure;
          if (coverUrl) { URL.revokeObjectURL(coverUrl); coverUrl = undefined; }
          setCoverFailed(true);
        }
      }
      if (summary.audio) {
        try {
          audio = await (await expectOk(await fetch(assetUrl(id, versionId, "audio"), { signal: aborter.signal, cache: "no-store" }))).arrayBuffer();
          if (disposed) return;
        } catch (failure) {
          if (disposed) return;
          if (failure instanceof ApiError && failure.status < 500) throw failure;
          setSilent(true);
        }
      }
      setReady(true);
    })().catch(failure => {
      if (!disposed) {
        setError(failure); cleanup(); player.current = null;
        const target = assetUrl === chartAssetUrl ? accountErrorRedirect(failure, `${window.location.pathname}${window.location.search}`) : null;
        if (target) window.location.assign(target);
      }
    });
    return () => { cleanup(); player.current = null; };
  }, [id, versionId, difficulty, opened, duration, summary.audio, summary.hasCover, assetUrl]);
  return <section ref={section} id={sectionId} tabIndex={0} onKeyDown={shortcuts} aria-label={previewTitle}
    className={`scroll-mt-24 space-y-3 rounded-lg border bg-background p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${fullscreen ? "h-dvh overflow-y-auto" : ""}`}>
    <h2 className="font-semibold">{previewTitle}</h2>
    <p className="text-sm text-muted-foreground">{m.chart_preview_hint()}</p>
    <label className="block text-sm">{m.chart_difficulties()}
      <select value={difficulty ?? ""} onChange={event => setDifficulty(Number(event.target.value) as ChartDifficulty)} className="ml-2 min-h-11 rounded border bg-background px-2 py-1">
        {!difficulty ? <option value="">{m.chart_unsupported()}</option> : null}
        {summary.difficulties.map(row => <option key={row.difficulty} value={row.difficulty} disabled={!row.previewSupported}>
          {publicDifficultyName(row.difficulty)}{row.previewSupported ? "" : ` · ${m.chart_unsupported()}`}
        </option>)}
      </select>
    </label>
    {!opened ? <Button className="min-h-11" disabled={!difficulty} onClick={() => setOpened(true)}>{m.chart_preview_load()}</Button> : <>
      <div className={`mx-auto aspect-square w-full bg-black ${fullscreen ? "max-w-[min(65dvh,100%)]" : "max-w-lg"}`}><canvas ref={canvas} aria-label={previewTitle} className="h-full w-full" /></div>
      {!ready && !error ? <p role="status">{m.chart_preview_loading()}</p> : null}
      {silent ? <p role="status" className="text-sm">{m.chart_preview_silent()}</p> : null}
      {coverFailed ? <p role="status" className="text-sm">{m.chart_preview_cover_failed()}</p> : null}
      <div role="group" aria-label={m.chart_preview_controls()} className="flex flex-wrap items-center gap-2">
        <Button className="min-h-11" disabled={!ready} onClick={() => playing ? player.current?.pause() : void player.current?.play()}>{playing ? m.chart_pause() : m.chart_play()}</Button>
        <Button variant="outline" className="min-h-11" onClick={closePreview}>{m.chart_close()}</Button>
        <span className="text-sm tabular-nums">{previewTime(position)} / {previewTime(duration)}</span>
        {fullscreenSupported ? <Button type="button" variant="outline" className="min-h-11" disabled={fullscreenPending} onClick={() => void toggleFullscreen()}>
          {fullscreen ? <MinimizeIcon aria-hidden="true" /> : <MaximizeIcon aria-hidden="true" />}{fullscreen ? m.chart_preview_exit_fullscreen() : m.chart_preview_fullscreen()}
        </Button> : null}
      </div>
      <input type="range" min={0} max={duration} step={0.1} value={position} disabled={!ready} aria-label={m.chart_seek()} className="min-h-11 w-full" onChange={event => player.current?.seek(Number(event.target.value))} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">{m.chart_preview_rate()}
          <select value={rate} onChange={event => changeRate(Number(event.target.value))} className="min-h-11 rounded border bg-background px-2">
            {PREVIEW_RATES.map(rate => <option key={rate} value={rate}>{rate}×</option>)}
          </select>
        </label>
        <Button type="button" variant="outline" className="min-h-11" aria-pressed={muted} disabled={silent} onClick={toggleMuted} aria-label={muted ? m.chart_preview_unmute() : m.chart_preview_mute()}>
          {muted ? <VolumeXIcon aria-hidden="true" /> : <Volume2Icon aria-hidden="true" />}
        </Button>
        <label className="flex min-w-0 flex-1 basis-40 items-center gap-2 text-sm">{m.chart_preview_volume()}
          <input type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume} disabled={silent} className="min-h-11 w-full min-w-0" onChange={event => changeVolume(Number(event.target.value))} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{m.chart_preview_shortcuts()}</p>
      {rate !== 1 ? <p className="text-xs text-muted-foreground">{m.chart_preview_rate_pitch()}</p> : null}
    </>}
    {fullscreenFailed ? <p role="status" className="text-sm text-muted-foreground">{m.chart_preview_fullscreen_failed()}</p> : null}
    {error ? <Alert role="alert" variant="destructive">{assetUrl === chartAssetUrl ? chartErrorMessage(error) : m.public_chart_unavailable()}</Alert> : null}
  </section>;
}
