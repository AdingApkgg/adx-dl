"use client";

import { useEffect, useRef, useCallback } from "react";
import { useGameStore, playbackTimeRef, audioMasterTimeMsRef } from "./store/game-store";
import { useGameSettingsStore, FULLSCREEN_QUALITY_MP } from "./store/settings-store";
import { MainRenderer, ANSWER_SOUND_BASE_OFFSET_MS } from "@lxns-network/maimai-chart-engine";
import { useAudio } from "./hooks/use-audio";
import { useMusicPlayer } from "./hooks/use-music-player";
import { beatsToMs, msToBeats } from "./lib/time-conversion";
import { formatChartTimeForFilename } from "./lib/format";
import { sanitizeFilenameId, downloadBlob } from "./lib/file-download";
import classes from "./chart-canvas.module.css";
import { cn } from "@/lib/utils";

// Window events the controls dispatch to ask the canvas to export the current
// frame (kept as events so the controls don't need a ref to the canvas).
export const EXPORT_FRAME_EVENT = "astrodx-chart-export-frame";
export const COPY_FRAME_EVENT = "astrodx-chart-copy-frame";

export type ChartCanvasProps = {
  /** PV video URL (entry.files.pv); drawn behind the chart when `showVideo` is on. */
  videoUrl?: string;
  /** Used to name exported PNG files. */
  chartName?: string;
};

export function ChartCanvas({ videoUrl, chartName = "chart" }: ChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MainRenderer | null>(null);
  const bgVideoRef = useRef<HTMLVideoElement>(null);

  const animationFrameRef = useRef<number | null>(null);
  const playbackStartTimeRef = useRef<number>(0);
  const playbackStartMsRef = useRef<number>(0);

  const fpsRef = useRef<number>(0);
  const frameTimesRef = useRef<number[]>([]);
  const lastFrameTimeRef = useRef<number>(0);
  const lastRenderTimeRef = useRef<number>(0);
  const accumulatedTimeRef = useRef<number>(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const answerSound = useAudio({ autoInit: true });
  const answerSoundRefs = useRef({
    schedule: answerSound.schedule,
    reset: answerSound.reset,
    setEnabled: answerSound.setEnabled,
    setVolume: answerSound.setVolume,
    setTimingOffset: answerSound.setTimingOffset,
    resume: answerSound.resume,
  });

  useEffect(() => {
    answerSoundRefs.current = {
      schedule: answerSound.schedule,
      reset: answerSound.reset,
      setEnabled: answerSound.setEnabled,
      setVolume: answerSound.setVolume,
      setTimingOffset: answerSound.setTimingOffset,
      resume: answerSound.resume,
    };
  }, [answerSound]);

  useMusicPlayer();

  const isFullscreen = useGameStore((s) => s.isFullscreen);
  const isPlaying = useGameStore((s) => s.isPlaying);
  const chartData = useGameStore((s) => s.chartData);
  const totalMeasures = useGameStore((s) => s.timeline.totalMeasures);
  const beatsPerMeasure = useGameStore((s) => s.timeline.beatsPerMeasure);
  const playbackSpeed = useGameStore((s) => s.playbackSpeed);
  const setPreciseTime = useGameStore((s) => s.setPreciseTime);
  const pause = useGameStore((s) => s.pause);

  const hiSpeed = useGameSettingsStore((s) => s.hiSpeed);
  const alwaysKeepHiSpeed = useGameSettingsStore((s) => s.alwaysKeepHiSpeed);
  const slideRotation = useGameSettingsStore((s) => s.slideRotation);
  const mirrorMode = useGameSettingsStore((s) => s.mirrorMode);
  const judgmentLineDesign = useGameSettingsStore((s) => s.judgmentLineDesign);
  const pinkSlideStart = useGameSettingsStore((s) => s.pinkSlideStart);
  const highlightExNotes = useGameSettingsStore((s) => s.highlightExNotes);
  const normalColorBreakSlide = useGameSettingsStore((s) => s.normalColorBreakSlide);
  const showFireworks = useGameSettingsStore((s) => s.showFireworks);
  const showHitEffect = useGameSettingsStore((s) => s.showHitEffect);
  const showVideo = useGameSettingsStore((s) => s.showVideo);
  const soundEnabled = useGameSettingsStore((s) => s.soundEnabled);
  const soundVolume = useGameSettingsStore((s) => s.soundVolume);
  const soundOffset = useGameSettingsStore((s) => s.soundOffset);
  const fullscreenQuality = useGameSettingsStore((s) => s.fullscreenQuality);

  const playbackSpeedRef = useRef(playbackSpeed);

  const getPlaybackMs = useCallback((timestamp: number) => {
    const elapsed = (timestamp - playbackStartTimeRef.current) * playbackSpeedRef.current;
    return playbackStartMsRef.current + elapsed;
  }, []);

  const releaseWakeLock = useCallback(async () => {
    const wakeLock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (!wakeLock) return;
    try {
      await wakeLock.release();
    } catch {
      // 忽略已经释放的 wake lock
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (
      !useGameStore.getState().isPlaying ||
      document.visibilityState !== "visible" ||
      wakeLockRef.current
    ) {
      return;
    }
    const wakeLockApi = navigator.wakeLock;
    if (!wakeLockApi) return;
    try {
      const wakeLock = await wakeLockApi.request("screen");
      wakeLockRef.current = wakeLock;
      wakeLock.addEventListener?.("release", () => {
        if (wakeLockRef.current === wakeLock) wakeLockRef.current = null;
      });
    } catch {
      // 浏览器/系统可能拒绝 wake lock，预览继续工作即可
    }
  }, []);

  const resyncAnswerSound = useCallback(
    (currentMs: number, speed: number = playbackSpeedRef.current) => {
      if (!chartData || !soundEnabled) return;
      answerSoundRefs.current.reset(currentMs);
      answerSoundRefs.current.schedule(chartData.notes, currentMs, speed);
    },
    [chartData, soundEnabled],
  );

  const renderFrame = useCallback((beatsOverride?: number) => {
    const renderer = rendererRef.current;
    const chart = useGameStore.getState().chartData;
    const timeline = useGameStore.getState().timeline;
    const playing = useGameStore.getState().isPlaying;
    const sound = useGameSettingsStore.getState().soundEnabled;

    if (!renderer) return;

    if (!chart) {
      renderer.clear();
      renderer.renderJudgmentLine();
      return;
    }
    const currentBeats = beatsOverride ?? timeline.preciseTime;
    const currentMs = beatsToMs(currentBeats, chart.bpmEvents, chart.bpm);

    // 背景视频：必须在 renderFrame 之前注入帧源（renderFrame 内部 clear 时绘制背景）
    const bgVideo = bgVideoRef.current;
    const enabled = !!bgVideo && useGameSettingsStore.getState().showVideo;
    if (enabled && bgVideo) {
      const leadInMs = (60000 * 4) / chart.bpm;
      const musicOffset = useGameSettingsStore.getState().musicOffset;
      const target = (currentMs - leadInMs - musicOffset) / 1000;
      const duration = bgVideo.duration;
      const totalBeats = timeline.totalMeasures * timeline.beatsPerMeasure;
      const stoppedAtEnd = !playing && currentBeats >= totalBeats;
      const inWindow =
        target > 0 && !stoppedAtEnd && (!Number.isFinite(duration) || target < duration);
      renderer.setBackgroundVideo(inWindow ? bgVideo : null);
      if (!inWindow) {
        if (!bgVideo.paused) bgVideo.pause();
        if (target <= 0 && bgVideo.currentTime > 0) bgVideo.currentTime = 0;
      } else if (playing) {
        const speed = useGameStore.getState().playbackSpeed;
        const drift = bgVideo.currentTime - target;
        if (Math.abs(drift) > 0.3) {
          bgVideo.currentTime = target;
          bgVideo.playbackRate = speed;
        } else {
          bgVideo.playbackRate =
            drift < -0.02 ? speed + 0.1 : drift > 0.02 ? Math.max(0.1, speed - 0.1) : speed;
        }
        if (bgVideo.paused) void bgVideo.play().catch(() => {});
      } else {
        if (!bgVideo.paused) bgVideo.pause();
        if (Math.abs(bgVideo.currentTime - target) > 0.04) bgVideo.currentTime = target;
      }
    } else {
      renderer.setBackgroundVideo(null);
    }

    renderer.renderFrame(chart, currentBeats, timeline.beatsPerMeasure);

    if (sound && playing) {
      answerSoundRefs.current.schedule(chart.notes, currentMs, playbackSpeedRef.current);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new MainRenderer(canvas, chartData?.bpm ?? 120);
    renderer.setIsPlaying(useGameStore.getState().isPlaying);
    rendererRef.current = renderer;

    const settingsState = useGameSettingsStore.getState();
    renderer.setHiSpeed(settingsState.hiSpeed);
    renderer.setAlwaysKeepHiSpeed(settingsState.alwaysKeepHiSpeed);
    renderer.setSlideRotation(settingsState.slideRotation);
    renderer.setMirrorMode(settingsState.mirrorMode);
    renderer.setJudgmentLineDesign(settingsState.judgmentLineDesign);
    renderer.setPinkSlideStart(settingsState.pinkSlideStart);
    renderer.setHighlightExNotes(settingsState.highlightExNotes);
    renderer.setNormalColorBreakSlide(settingsState.normalColorBreakSlide);
    renderer.setShowFireworks(settingsState.showFireworks);
    renderer.setShowHitEffect(settingsState.showHitEffect);
    renderer.setFullscreenMaxPixels(FULLSCREEN_QUALITY_MP[settingsState.fullscreenQuality]);
    renderer.setPlaybackSpeed(useGameStore.getState().playbackSpeed);

    const handleResize = () => {
      renderer.resize(useGameStore.getState().isFullscreen);
      renderFrame(playbackTimeRef.current);
    };

    handleResize();

    const resizeObserver = new ResizeObserver(handleResize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    const dprMediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprMediaQuery.addEventListener("change", handleResize);

    return () => {
      resizeObserver.disconnect();
      dprMediaQuery.removeEventListener("change", handleResize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [renderFrame, chartData?.bpm]);

  // 全屏 / 画质：重设最大像素并 resize。
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setFullscreenMaxPixels(FULLSCREEN_QUALITY_MP[fullscreenQuality]);
    renderer.resize(isFullscreen);
    renderFrame(playbackTimeRef.current);
  }, [isFullscreen, fullscreenQuality, renderFrame]);

  // 背景视频：加载/卸载 PV。
  useEffect(() => {
    const video = bgVideoRef.current;
    if (!video) return;
    const refresh = () => {
      if (!useGameStore.getState().isPlaying) renderFrame(playbackTimeRef.current);
    };
    if (showVideo && videoUrl) {
      video.src = videoUrl;
      video.load();
      video.addEventListener("loadeddata", refresh);
      video.addEventListener("seeked", refresh);
    } else {
      video.removeAttribute("src");
      video.load();
    }
    renderFrame(playbackTimeRef.current);
    return () => {
      video.removeEventListener("loadeddata", refresh);
      video.removeEventListener("seeked", refresh);
    };
  }, [showVideo, videoUrl, chartData, renderFrame]);

  // 导出 / 复制当前帧（由控制条派发 window 事件触发）。
  useEffect(() => {
    const notify = (title: string, message: string, color: string) => {
      window.dispatchEvent(
        new CustomEvent("astrodx-chart-notify", { detail: { title, message, color } }),
      );
    };

    const canvasToBlob = (canvas: HTMLCanvasElement) =>
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob returned null"))),
          "image/png",
        ),
      );

    const exportFrame = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const chart = useGameStore.getState().chartData;
      const currentMs = chart ? beatsToMs(playbackTimeRef.current, chart.bpmEvents, chart.bpm) : 0;
      const filename = `maimai-chart-${sanitizeFilenameId(chartName)}-${formatChartTimeForFilename(
        currentMs,
      )}.png`;

      let blob: Blob;
      try {
        blob = await canvasToBlob(canvas);
      } catch {
        notify("导出失败", "无法获取当前帧", "red");
        return;
      }

      const file = new File([blob], filename, { type: "image/png" });
      try {
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file] });
          return;
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
      downloadBlob(blob, filename);
      notify("已保存", "当前帧已下载为 PNG", "green");
    };

    const copyFrame = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": canvasToBlob(canvas) }),
        ]);
        notify("已复制", "当前帧已复制到剪贴板", "green");
      } catch {
        notify("复制失败", "剪贴板不可用", "red");
      }
    };

    window.addEventListener(EXPORT_FRAME_EVENT, exportFrame);
    window.addEventListener(COPY_FRAME_EVENT, copyFrame);
    return () => {
      window.removeEventListener(EXPORT_FRAME_EVENT, exportFrame);
      window.removeEventListener(COPY_FRAME_EVENT, copyFrame);
    };
  }, [chartName]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setIsPlaying(isPlaying);
    }
    if (!isPlaying) bgVideoRef.current?.pause();
  }, [isPlaying]);

  useEffect(() => {
    if (isPlaying) {
      void requestWakeLock();
      return;
    }
    void releaseWakeLock();
  }, [isPlaying, requestWakeLock, releaseWakeLock]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void requestWakeLock();
        return;
      }
      void releaseWakeLock();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [requestWakeLock, releaseWakeLock]);

  useEffect(() => {
    return () => {
      void releaseWakeLock();
    };
  }, [releaseWakeLock]);

  useEffect(() => {
    if (isPlaying) return;
    const currentChart = useGameStore.getState().chartData;
    if (!currentChart) {
      answerSoundRefs.current.reset(undefined, true);
      return;
    }
    const currentMs = beatsToMs(playbackTimeRef.current, currentChart.bpmEvents, currentChart.bpm);
    answerSoundRefs.current.reset(currentMs, true);
  }, [isPlaying]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setHiSpeed(hiSpeed);
      renderFrame(playbackTimeRef.current);
    }
  }, [hiSpeed, renderFrame]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setAlwaysKeepHiSpeed(alwaysKeepHiSpeed);
      renderFrame(playbackTimeRef.current);
    }
  }, [alwaysKeepHiSpeed, renderFrame]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setPlaybackSpeed(playbackSpeed);
      renderFrame(playbackTimeRef.current);
    }
  }, [playbackSpeed, renderFrame]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setSlideRotation(slideRotation);
      renderFrame(playbackTimeRef.current);
    }
  }, [slideRotation, renderFrame]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setMirrorMode(mirrorMode);
      renderFrame(playbackTimeRef.current);
    }
  }, [mirrorMode, renderFrame]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setJudgmentLineDesign(judgmentLineDesign);
      renderFrame(playbackTimeRef.current);
    }
  }, [judgmentLineDesign, renderFrame]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setPinkSlideStart(pinkSlideStart);
      renderFrame(playbackTimeRef.current);
    }
  }, [pinkSlideStart, renderFrame]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setHighlightExNotes(highlightExNotes);
      renderFrame(playbackTimeRef.current);
    }
  }, [highlightExNotes, renderFrame]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setNormalColorBreakSlide(normalColorBreakSlide);
      renderFrame(playbackTimeRef.current);
    }
  }, [normalColorBreakSlide, renderFrame]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setShowFireworks(showFireworks);
      renderFrame(playbackTimeRef.current);
    }
  }, [showFireworks, renderFrame]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setShowHitEffect(showHitEffect);
      renderFrame(playbackTimeRef.current);
    }
  }, [showHitEffect, renderFrame]);

  useEffect(() => {
    if (rendererRef.current && chartData) {
      rendererRef.current.setBpm(chartData.bpm);
    }
  }, [chartData]);

  useEffect(() => {
    answerSoundRefs.current.setEnabled(soundEnabled);
    if (!chartData || !isPlaying) return;
    const currentMs = beatsToMs(playbackTimeRef.current, chartData.bpmEvents, chartData.bpm);
    resyncAnswerSound(currentMs);
  }, [soundEnabled, chartData, isPlaying, resyncAnswerSound]);

  useEffect(() => {
    answerSoundRefs.current.setVolume(soundVolume);
  }, [soundVolume]);

  useEffect(() => {
    answerSoundRefs.current.setTimingOffset(ANSWER_SOUND_BASE_OFFSET_MS + soundOffset);
    if (!chartData || !isPlaying || !soundEnabled) return;
    const currentMs = beatsToMs(playbackTimeRef.current, chartData.bpmEvents, chartData.bpm);
    resyncAnswerSound(currentMs);
  }, [soundOffset, chartData, isPlaying, soundEnabled, resyncAnswerSound]);

  // 切速度时重锚 startTime/startMs，避免外推位置跳变。
  useEffect(() => {
    if (isPlaying && chartData) {
      const currentBeats = playbackTimeRef.current;
      playbackStartTimeRef.current = performance.now();
      playbackStartMsRef.current = beatsToMs(currentBeats, chartData.bpmEvents, chartData.bpm);
      if (soundEnabled) {
        resyncAnswerSound(playbackStartMsRef.current, playbackSpeed);
      }
    }
    playbackSpeedRef.current = playbackSpeed;
  }, [playbackSpeed, isPlaying, chartData, soundEnabled, resyncAnswerSound]);

  useEffect(() => {
    if (!isPlaying || !chartData || !soundEnabled) return;
    const intervalId = window.setInterval(() => {
      if (!useGameStore.getState().isPlaying || !useGameSettingsStore.getState().soundEnabled) {
        return;
      }
      const currentMs = getPlaybackMs(performance.now());
      answerSoundRefs.current.schedule(chartData.notes, currentMs, playbackSpeedRef.current);
    }, 250);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isPlaying, chartData, soundEnabled, getPlaybackMs]);

  useEffect(() => {
    if (!isPlaying || !chartData) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    answerSoundRefs.current.resume();

    const totalBeats = totalMeasures * beatsPerMeasure;
    const totalDurationMs = beatsToMs(totalBeats, chartData.bpmEvents, chartData.bpm);

    let lastSeekVersion = useGameStore.getState().seekVersion;
    let anchorInitialized = false;

    const animate = (timestamp: number) => {
      if (!anchorInitialized) {
        anchorInitialized = true;
        const currentPreciseTime = useGameStore.getState().timeline.preciseTime;
        playbackStartTimeRef.current = timestamp;
        playbackStartMsRef.current = beatsToMs(
          currentPreciseTime,
          chartData.bpmEvents,
          chartData.bpm,
        );
        answerSoundRefs.current.reset(playbackStartMsRef.current, true);
      }

      const limit = useGameSettingsStore.getState().fpsLimit;
      if (limit > 0 && lastRenderTimeRef.current > 0) {
        accumulatedTimeRef.current += timestamp - lastRenderTimeRef.current;
        lastRenderTimeRef.current = timestamp;
        if (accumulatedTimeRef.current < 1000 / limit) {
          animationFrameRef.current = requestAnimationFrame(animate);
          return;
        }
        accumulatedTimeRef.current -= 1000 / limit;
      }
      lastRenderTimeRef.current = timestamp;

      if (lastFrameTimeRef.current > 0) {
        const delta = timestamp - lastFrameTimeRef.current;
        frameTimesRef.current.push(delta);
        if (frameTimesRef.current.length > 60) {
          frameTimesRef.current.shift();
        }
        const avgDelta =
          frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length;
        fpsRef.current = Math.round(1000 / avgDelta);
        if (rendererRef.current) {
          rendererRef.current.setFps(fpsRef.current);
        }
      }
      lastFrameTimeRef.current = timestamp;

      const storeState = useGameStore.getState();
      if (storeState.seekVersion !== lastSeekVersion) {
        lastSeekVersion = storeState.seekVersion;
        playbackStartTimeRef.current = timestamp;
        playbackStartMsRef.current = beatsToMs(
          storeState.timeline.preciseTime,
          chartData.bpmEvents,
          chartData.bpm,
        );
        audioMasterTimeMsRef.current = null;
        answerSoundRefs.current.reset(playbackStartMsRef.current, true);
      }

      const audioMs = audioMasterTimeMsRef.current;
      let currentMs: number;
      if (audioMs !== null) {
        currentMs = audioMs;
        playbackStartTimeRef.current = timestamp;
        playbackStartMsRef.current = audioMs;
      } else {
        currentMs = getPlaybackMs(timestamp);
      }

      if (currentMs >= totalDurationMs + 500) {
        setPreciseTime(totalBeats);
        pause();
        return;
      }

      const currentBeats = msToBeats(currentMs, chartData.bpmEvents, chartData.bpm);
      playbackTimeRef.current = currentBeats;

      renderFrame(currentBeats);

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [
    isPlaying,
    chartData,
    totalMeasures,
    beatsPerMeasure,
    pause,
    setPreciseTime,
    renderFrame,
    getPlaybackMs,
  ]);

  // 暂停态：进度条拖动时实时预览（rAF 节流，只在时间变了重渲染）。
  useEffect(() => {
    if (isPlaying) return;

    let previewAnimationFrameId: number | null = null;
    let lastPreviewedTime = -1;

    const updatePreview = () => {
      const currentTime = playbackTimeRef.current;
      if (currentTime !== lastPreviewedTime) {
        lastPreviewedTime = currentTime;
        renderFrame(currentTime);
      }
      previewAnimationFrameId = requestAnimationFrame(updatePreview);
    };

    renderFrame(playbackTimeRef.current);
    previewAnimationFrameId = requestAnimationFrame(updatePreview);

    return () => {
      if (previewAnimationFrameId) {
        cancelAnimationFrame(previewAnimationFrameId);
      }
    };
  }, [isPlaying, renderFrame]);

  return (
    <div ref={containerRef} className={cn(classes.container, isFullscreen && classes.fullscreen)}>
      <video
        ref={bgVideoRef}
        muted
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
          top: 0,
          left: 0,
        }}
      />
      <canvas
        ref={canvasRef}
        className={cn(classes.canvas, isFullscreen && classes.fullscreen)}
      />
    </div>
  );
}

export default ChartCanvas;
