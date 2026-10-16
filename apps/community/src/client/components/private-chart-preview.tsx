import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { useEffect, useRef, useState } from "react";
import { m } from "@/paraglide/messages.js";
import { ApiError, expectOk } from "@/shared/api-client";
import type { ChartDifficulty, ChartImportSummary } from "@/shared/charts";
import { normalizeChartMaidata } from "@/shared/charts-maidata";
import { chartErrorMessage } from "../lib/chart-errors";
import { accountErrorRedirect } from "../lib/account-errors";
import { chartAssetUrl } from "../queries/charts";

type Player = { play(): Promise<void>; pause(): void; seek(seconds: number): void; dispose(): void };

export function PrivateChartPreview({ id, versionId, summary, assetUrl = chartAssetUrl, sectionId }: {
  id: string; versionId: string; summary: ChartImportSummary; assetUrl?: typeof chartAssetUrl; sectionId?: string;
}) {
  const previewTitle = assetUrl === chartAssetUrl ? m.chart_preview() : m.public_chart_preview();
  const [difficulty, setDifficulty] = useState<ChartDifficulty | undefined>(() => summary.difficulties.find((row) => row.previewSupported)?.difficulty);
  const [opened, setOpened] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [silent, setSilent] = useState(!summary.audio);
  const [error, setError] = useState<unknown>();
  const [coverFailed, setCoverFailed] = useState(false);
  const [position, setPosition] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<Player | null>(null);
  const duration = (summary.difficulties.find((row) => row.difficulty === difficulty)?.durationMs ?? 0) / 1000;
  useEffect(() => {
    if (!opened || !difficulty || !canvas.current) return;
    const aborter = new AbortController();
    let disposed = false;
    let context: AudioContext | undefined;
    let source: AudioBufferSourceNode | undefined;
    let decoded: AudioBuffer | undefined;
    let audio: ArrayBuffer | undefined;
    let decoding: Promise<void> | undefined;
    let frame = 0;
    let time = 0;
    let started = 0;
    let lastPositionUpdate = 0;
    let running = false;
    let starting = false;
    let playbackGeneration = 0;
    let coverUrl: string | undefined;
    let resize: ResizeObserver | undefined;
    let renderer: import("@lxns-network/maimai-chart-engine").MainRenderer | undefined;
    setReady(false); setPlaying(false); setSilent(!summary.audio); setError(undefined); setCoverFailed(false); setPosition(0);
    const stopSource = () => { try { source?.stop(); } catch {} source?.disconnect(); source = undefined; };
    const cleanup = () => {
      if (disposed) return;
      disposed = true; aborter.abort(); cancelAnimationFrame(frame); stopSource(); resize?.disconnect();
      renderer?.setBackgroundImage(null);
      if (coverUrl) URL.revokeObjectURL(coverUrl);
      void context?.close().catch(() => {});
      audio = undefined; decoded = undefined;
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
        time = Math.min(duration, (performance.now() - started) / 1000);
        render();
        if (performance.now() - lastPositionUpdate >= 200 || time >= duration) { lastPositionUpdate = performance.now(); setPosition(time); }
        if (time >= duration) { running = false; stopSource(); renderer?.setIsPlaying(false); setPlaying(false); }
        else frame = requestAnimationFrame(tick);
      };
      const startSource = () => {
        if (!decoded || !context) return;
        // The engine adds four lead-in beats before the chart body; &first applies at that body origin.
        const offset = time - 240 / chart.bpm + (chart.firstMs ?? 0) / 1000;
        if (offset >= decoded.duration) return;
        source = context.createBufferSource(); source.buffer = decoded; source.connect(context.destination);
        source.start(context.currentTime + Math.max(0, -offset), Math.max(0, offset));
      };
      const pause = () => {
        ++playbackGeneration;
        if (running) time = Math.min(duration, (performance.now() - started) / 1000);
        running = false; cancelAnimationFrame(frame); stopSource(); renderer?.setIsPlaying(false);
        if (!disposed) { setPlaying(false); setPosition(time); render(); }
      };
      player.current = {
        async play() {
          if (disposed || running || starting) return;
          starting = true;
          const generation = playbackGeneration;
          try {
            if (time >= duration) time = 0;
            if (audio && !decoded) {
              try {
                context ??= new AudioContext();
                await context.resume();
                decoding ??= context.decodeAudioData(audio).then((buffer) => { if (!disposed) decoded = buffer; audio = undefined; });
                await decoding;
              } catch { audio = undefined; if (!disposed) setSilent(true); }
            }
            if (disposed || generation !== playbackGeneration) return;
            if (context) {
              try { await context.resume(); }
              catch { if (!disposed) setSilent(true); stopSource(); void context.close().catch(() => {}); context = undefined; decoded = undefined; }
            }
            if (disposed || generation !== playbackGeneration) return;
            running = true; started = performance.now() - time * 1000;
            renderer?.setIsPlaying(true); startSource(); setPlaying(true); frame = requestAnimationFrame(tick);
          } finally { starting = false; }
        },
        pause,
        seek(seconds) { const wasPlaying = running; pause(); time = Math.max(0, Math.min(duration, seconds)); render(); setPosition(time); if (wasPlaying) void this.play(); },
        dispose: cleanup,
      };
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
    })().catch((failure) => {
      if (!disposed) {
        setError(failure); cleanup(); player.current = null;
        const target = assetUrl === chartAssetUrl ? accountErrorRedirect(failure, `${window.location.pathname}${window.location.search}`) : null;
        if (target) window.location.assign(target);
      }
    });
    return () => { cleanup(); player.current = null; };
  }, [id, versionId, difficulty, opened, duration, summary.audio, summary.hasCover, assetUrl]);
  return <section id={sectionId} tabIndex={sectionId ? -1 : undefined} aria-label={previewTitle} className="scroll-mt-24 space-y-3 rounded-lg border p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
    <h2 className="font-semibold">{previewTitle}</h2>
    <p className="text-sm text-muted-foreground">{m.chart_preview_hint()}</p>
    <label className="block text-sm">{m.chart_difficulties()}
      <select value={difficulty ?? ""} onChange={(event) => setDifficulty(Number(event.target.value) as ChartDifficulty)} className="ml-2 rounded border px-2 py-1">
        {!difficulty ? <option value="">{m.chart_unsupported()}</option> : null}
        {summary.difficulties.map((row) => <option key={row.difficulty} value={row.difficulty} disabled={!row.previewSupported}>
          {m.chart_difficulty({ difficulty: String(row.difficulty) })}{row.previewSupported ? "" : ` · ${m.chart_unsupported()}`}
        </option>)}
      </select>
    </label>
    {!opened ? <Button disabled={!difficulty} onClick={() => setOpened(true)}>{m.chart_preview_load()}</Button> : <>
      <div className="mx-auto aspect-square w-full max-w-lg bg-black"><canvas ref={canvas} aria-label={previewTitle} className="h-full w-full" /></div>
      {!ready && !error ? <p role="status">{m.chart_preview_loading()}</p> : null}
      {silent ? <p role="status" className="text-sm">{m.chart_preview_silent()}</p> : null}
      {coverFailed ? <p role="status" className="text-sm">{m.chart_preview_cover_failed()}</p> : null}
      <div className="flex items-center gap-2">
        <Button disabled={!ready} onClick={() => playing ? player.current?.pause() : void player.current?.play()}>{playing ? m.chart_pause() : m.chart_play()}</Button>
        <Button variant="outline" onClick={() => setOpened(false)}>{m.chart_close()}</Button>
        <span className="text-sm tabular-nums">{Math.floor(position)} / {Math.ceil(duration)} s</span>
      </div>
      <input type="range" min={0} max={duration} step={0.1} value={position} disabled={!ready} aria-label={m.chart_seek()} className="w-full" onChange={(event) => player.current?.seek(Number(event.target.value))} />
    </>}
    {error ? <Alert role="alert" variant="destructive">{assetUrl === chartAssetUrl ? chartErrorMessage(error) : m.public_chart_unavailable()}</Alert> : null}
  </section>;
}
