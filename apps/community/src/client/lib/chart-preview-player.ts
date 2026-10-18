import type { Chart, MirrorMode, Note } from "@lxns-network/maimai-chart-engine";
import { ApiError, expectOk } from "@/shared/api-client";
import type { ChartAssetRole, ChartDifficulty, ChartImportSummary } from "@/shared/charts";
import { normalizeChartMaidata } from "@/shared/charts-maidata";
import { PREVIEW_RATES, previewAudioStart } from "./chart-preview-controls";
import { loopPosition, normalizePreviewRange, type PreviewRange } from "./chart-preview-practice";

type AssetUrl = (id: string, versionId: string, role: ChartAssetRole) => string;
export type PreviewPlayer = {
  play(): Promise<void>; pause(): void; seek(seconds: number): void; seekBy(seconds: number): void;
  position(): number; setRate(value: number): void; setVolume(value: number): void;
  setRange(range: PreviewRange | null, enabled: boolean): void; setMirror(mode: MirrorMode): void;
  exportGif(range: PreviewRange, signal: AbortSignal, progress: (value: number) => void): Promise<Blob>;
  dispose(): void;
};
type Options = {
  id: string; versionId: string; difficulty: ChartDifficulty; duration: number; summary: ChartImportSummary;
  canvas: HTMLCanvasElement; assetUrl: AssetUrl; rate: number; volume: number; mirror: MirrorMode;
  onReady(ready: boolean): void; onPlaying(playing: boolean): void; onPosition(position: number): void;
  onNotes(notes: readonly Note[]): void; onSilent(): void; onCoverFailed(): void;
  onLoopDisabled(): void; onError(error: unknown): void;
};
/** One instance owns all async work. No shared clock, chart or authorization resolver. */
export function createPreviewPlayer(options: Options): PreviewPlayer {
  const { id, versionId, difficulty, duration, summary, canvas, assetUrl } = options;
  const aborter = new AbortController();
  let disposed = false, ready = false, running = false, wantsToPlay = false;
  let time = 0, anchor = 0, started = 0, generation = 0, frame = 0, lastUpdate = 0;
  let speed = options.rate, volume = options.volume, mirror = options.mirror;
  let range: PreviewRange | null = null, loop = false;
  let chart: Chart | undefined;
  let renderer: import("@lxns-network/maimai-chart-engine").MainRenderer | undefined;
  let timeline: import("@lxns-network/maimai-chart-engine").TimingTimeline | undefined;
  let resize: ResizeObserver | undefined, coverUrl: string | undefined;
  let context: AudioContext | undefined, gain: GainNode | undefined, source: AudioBufferSourceNode | undefined;
  let decoded: AudioBuffer | undefined, audio: ArrayBuffer | undefined, preparing: Promise<void> | undefined;
  let exporting: AbortController | undefined;
  let sourceLoops = false;
  const clock = () => context ? context.currentTime : performance.now() / 1000;
  const current = () => {
    const raw = running ? anchor + Math.max(0, clock() - started) * speed : time;
    return loop && range ? loopPosition(raw, range) : raw;
  };
  const render = () => { if (chart && timeline) renderer?.renderFrame(chart, timeline.beatFromMs(time * 1000), 4); };
  const stopSource = () => { try { source?.stop(); } catch {} source?.disconnect(); source = undefined; sourceLoops = false; };
  const closeAudio = () => { stopSource(); gain?.disconnect(); gain = undefined; void context?.close().catch(() => {}); context = undefined; decoded = undefined; };
  const pause = () => {
    ++generation; wantsToPlay = false;
    time = Math.max(0, Math.min(duration, current())); running = false;
    cancelAnimationFrame(frame); stopSource(); renderer?.setIsPlaying(false);
    if (!disposed) { options.onPlaying(false); options.onPosition(time); render(); }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; ready = false; wantsToPlay = false; running = false; ++generation;
    aborter.abort(); exporting?.abort(); cancelAnimationFrame(frame); closeAudio(); resize?.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    renderer?.setIsPlaying(false); renderer?.setBackgroundImage(null);
    renderer = undefined; chart = undefined; timeline = undefined; audio = undefined;
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    coverUrl = undefined;
  };
  const startSource = () => {
    if (!decoded || !context || !gain || disposed) return;
    const { delay, offset } = previewAudioStart(time, chart!.bpm, chart!.firstMs ?? 0, speed);
    if (offset >= decoded.duration) return;
    source = context.createBufferSource(); source.buffer = decoded;
    source.playbackRate.value = speed; source.connect(gain);
    if (loop && range) {
      const mediaA = range.start - 240 / chart!.bpm + (chart!.firstMs ?? 0) / 1000;
      const mediaB = range.end - 240 / chart!.bpm + (chart!.firstMs ?? 0) / 1000;
      // Native looping has no animation-frame gap. A range containing leading/trailing
      // silence needs the chart-clock fallback, since those samples aren't in this buffer.
      sourceLoops = mediaA >= 0 && mediaB <= decoded.duration;
      if (sourceLoops) { source.loop = true; source.loopStart = mediaA; source.loopEnd = mediaB; }
    }
    source.start(context.currentTime + delay, offset);
    if (loop && range && !sourceLoops) source.stop(context.currentTime + Math.max(0, range.end - time) / speed);
  };
  const tick = () => {
    if (disposed || !running) return;
    const at = clock();
    const raw = anchor + Math.max(0, at - started) * speed;
    const wrapped = loop && range && (raw >= range.end || raw < range.start);
    time = wrapped && range ? loopPosition(raw, range) : Math.max(0, Math.min(duration, raw));
    if (wrapped) {
      anchor = time; started = at;
      if (!sourceLoops) { stopSource(); startSource(); }
    }
    render();
    const now = performance.now();
    if (wrapped || now - lastUpdate >= 100 || time >= duration) { lastUpdate = now; options.onPosition(time); }
    if (time >= duration) {
      running = false; wantsToPlay = false; stopSource(); renderer?.setIsPlaying(false); options.onPlaying(false);
    } else frame = requestAnimationFrame(tick);
  };
  const prepareAudio = () => {
    if (!preparing && audio) preparing = (async () => {
      context = new AudioContext(); gain = context.createGain(); gain.gain.value = volume; gain.connect(context.destination);
      await context.resume();
      if (disposed || !audio) return;
      const bytes = audio; audio = undefined;
      const buffer = await context.decodeAudioData(bytes);
      if (!disposed) decoded = buffer;
    })().catch(() => { closeAudio(); audio = undefined; if (!disposed) options.onSilent(); });
    return preparing ?? Promise.resolve();
  };
  const onVisibility = () => {
    // An explicit pause avoids invisible chart-clock advancement, including loops with silence.
    if (document.hidden && loop && wantsToPlay) pause();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const player: PreviewPlayer = {
    async play() {
      if (disposed || !ready || running || exporting) return;
      wantsToPlay = true; options.onPlaying(true);
      const attempt = ++generation;
      if (loop && range && (time < range.start || time >= range.end)) time = range.start;
      else if (time >= duration) time = 0;
      await prepareAudio();
      if (disposed || attempt !== generation || !wantsToPlay) return;
      if (context) {
        try { await context.resume(); }
        catch { closeAudio(); if (!disposed) options.onSilent(); }
      }
      if (disposed || attempt !== generation || !wantsToPlay) return;
      anchor = time; started = clock(); running = true;
      renderer?.setIsPlaying(true); startSource(); options.onPlaying(true); frame = requestAnimationFrame(tick);
    },
    pause,
    position: () => Math.max(0, Math.min(duration, current())),
    seek(seconds) {
      if (disposed || exporting || !Number.isFinite(seconds)) return;
      const resume = wantsToPlay; pause(); time = Math.max(0, Math.min(duration, seconds));
      if (loop && range && (time < range.start || time >= range.end)) { loop = false; options.onLoopDisabled(); }
      render(); options.onPosition(time);
      if (resume && time < duration) void player.play();
    },
    seekBy(seconds) { player.seek(current() + seconds); },
    setRate(value) {
      if (disposed || exporting || !PREVIEW_RATES.some(rate => rate === value)) return;
      const resume = wantsToPlay; pause(); speed = value;
      if (resume) void player.play();
    },
    setVolume(value) { volume = Math.max(0, Math.min(1, value)); if (gain) gain.gain.value = volume; },
    setRange(value, enabled) {
      if (disposed || exporting) return;
      const resume = wantsToPlay; pause();
      range = value ? normalizePreviewRange(value, duration) : null; loop = Boolean(enabled && range);
      if (loop && range && (time < range.start || time >= range.end)) time = range.start;
      options.onPosition(time); render();
      if (resume) void player.play();
    },
    setMirror(value) { mirror = value; if (!disposed) { renderer?.setMirrorMode(mirror); render(); } },
    async exportGif(selection, signal, progress) {
      if (disposed || !ready || !chart || exporting || signal.aborted) throw new DOMException("Export unavailable", "AbortError");
      pause();
      const job = new AbortController(); exporting = job;
      const cancel = () => job.abort(); signal.addEventListener("abort", cancel, { once: true });
      try {
        // A fresh read reauthorizes this exact version, using only its original resolver.
        const response = await expectOk(await fetch(assetUrl(id, versionId, "maidata"), { signal: job.signal, cache: "no-store" }));
        const bytes = await response.arrayBuffer();
        if (job.signal.aborted || disposed) throw new DOMException("Export cancelled", "AbortError");
        const engine = await import("@lxns-network/maimai-chart-engine");
        const currentChart = engine.parseSimaiChart(normalizeChartMaidata(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).text, difficulty, { maxNotes: 100000, maxDurationMs: 3600000 });
        const { exportPreviewGif } = await import("./export-preview-gif");
        return await exportPreviewGif({ chart: currentChart, duration, range: selection, mirror, signal: job.signal, onProgress: progress });
      } catch (failure) {
        if (!disposed && failure instanceof ApiError && failure.status < 500) {
          options.onReady(false); options.onError(failure); dispose();
        }
        throw failure;
      } finally {
        signal.removeEventListener("abort", cancel);
        if (exporting === job) exporting = undefined;
      }
    },
    dispose,
  };
  void (async () => {
    const engine = await import("@lxns-network/maimai-chart-engine");
    if (disposed) return;
    const maidata = await (await expectOk(await fetch(assetUrl(id, versionId, "maidata"), { signal: aborter.signal, cache: "no-store" }))).arrayBuffer();
    if (disposed) return;
    chart = engine.parseSimaiChart(normalizeChartMaidata(new TextDecoder("utf-8", { fatal: true }).decode(maidata)).text, difficulty, { maxNotes: 100000, maxDurationMs: 3600000 });
    timeline = engine.TimingTimeline.fromChart(chart);
    renderer = new engine.MainRenderer(canvas, { sensorImagePath: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", showStatistics: false });
    renderer.setJudgmentLineDesign("simple"); renderer.setMirrorMode(mirror); render();
    options.onNotes(chart.notes);
    resize = new ResizeObserver(() => { renderer?.resize(); render(); }); resize.observe(canvas.parentElement!);
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
        options.onCoverFailed();
      }
    }
    if (summary.audio) {
      try {
        audio = await (await expectOk(await fetch(assetUrl(id, versionId, "audio"), { signal: aborter.signal, cache: "no-store" }))).arrayBuffer();
        if (disposed) return;
      } catch (failure) {
        if (disposed) return;
        if (failure instanceof ApiError && failure.status < 500) throw failure;
        options.onSilent();
      }
    }
    ready = true; options.onReady(true);
  })().catch(failure => {
    if (!disposed) { options.onReady(false); options.onError(failure); dispose(); }
  });
  return player;
}
