"use client";

import { useEffect, useRef, useCallback } from "react";
import { useGameStore, playbackTimeRef, audioMasterTimeMsRef } from "./store/game-store";
import { useGameSettingsStore } from "./store/settings-store";
import { MainRenderer, ANSWER_SOUND_BASE_OFFSET_MS } from "@lxns-network/maimai-chart-engine";
import { useAudio } from "./hooks/use-audio";
import { useMusicPlayer } from "./hooks/use-music-player";
import { beatsToMs, msToBeats } from "./lib/time-conversion";
import classes from "./chart-canvas.module.css";

// Spike scope vs. the upstream lxns ChartCanvas: this port drops the DEV debug
// overlay, the PNG/GIF frame-export listeners, and the background-PV-video path.
// The renderer, the RAF render loop, audio-clock sync, answer SFX scheduling and
// screen wake-lock are kept verbatim.
export function ChartCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MainRenderer | null>(null);

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
  const soundEnabled = useGameSettingsStore((s) => s.soundEnabled);
  const soundVolume = useGameSettingsStore((s) => s.soundVolume);
  const soundOffset = useGameSettingsStore((s) => s.soundOffset);

  const playbackSpeedRef = useRef(playbackSpeed);

  const getPlaybackMs = useCallback((timestamp: number) => {
    const elapsed = (timestamp - playbackStartTimeRef.current) * playbackSpeedRef.current;
    return playbackStartMsRef.current + elapsed;
  }, []);

  const releaseWakeLock = useCallback(async () => {
    const wakeLock = wakeLockRef.current;
    wakeLockRef.current = null;

    if (!wakeLock) {
      return;
    }

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
    if (!wakeLockApi) {
      return;
    }

    try {
      const wakeLock = await wakeLockApi.request("screen");
      wakeLockRef.current = wakeLock;
      wakeLock.addEventListener?.("release", () => {
        if (wakeLockRef.current === wakeLock) {
          wakeLockRef.current = null;
        }
      });
    } catch {
      // 浏览器/系统可能拒绝 wake lock，预览继续工作即可
    }
  }, []);

  const resyncAnswerSound = useCallback(
    (currentMs: number, speed: number = playbackSpeedRef.current) => {
      if (!chartData || !soundEnabled) {
        return;
      }

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
    renderer.setPlaybackSpeed(useGameStore.getState().playbackSpeed);

    const handleResize = () => {
      renderer.resize(false);
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

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setIsPlaying(isPlaying);
    }
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

    if (!chartData || !isPlaying) {
      return;
    }

    const currentMs = beatsToMs(playbackTimeRef.current, chartData.bpmEvents, chartData.bpm);
    resyncAnswerSound(currentMs);
  }, [soundEnabled, chartData, isPlaying, resyncAnswerSound]);

  useEffect(() => {
    answerSoundRefs.current.setVolume(soundVolume);
  }, [soundVolume]);

  useEffect(() => {
    answerSoundRefs.current.setTimingOffset(ANSWER_SOUND_BASE_OFFSET_MS + soundOffset);

    if (!chartData || !isPlaying || !soundEnabled) {
      return;
    }

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
        // 传入当前时间，避免播放之前已经过去的 note 音效
        answerSoundRefs.current.reset(playbackStartMsRef.current, true);
      }

      // 帧数限制：跳过帧的时间累积到 accumulatedTimeRef，攒够目标间隔才渲染
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

      // FPS 统计
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

      // 音频实际在跑时以 AudioContext 时钟为主，否则回落 rAF 外推。
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
    <div ref={containerRef} className={classes.container}>
      <canvas ref={canvasRef} className={classes.canvas} />
    </div>
  );
}

export default ChartCanvas;
