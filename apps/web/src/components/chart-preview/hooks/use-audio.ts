"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import {
  AudioManager,
  prepareAudioEvents,
  type PreparedAudioEvent,
  type Note,
  type AudioConfig,
  ANSWER_SOUND_BASE_OFFSET_MS,
} from "@lxns-network/maimai-chart-engine";
import { registerAudioContextForUnlock } from "../lib/audio-unlock";

// 上游 #48 后 AudioManager 不再自建 AudioContext，构造时需外部传入
// { audioContext, outputNode }，且 schedule() 改吃 prepareAudioEvents(notes) 的预处理事件、
// 删除了 resume()。本 hook 自持一个 AudioContext（正解音专用，与音乐播放的 context 分离），
// 对外接口保持不变，schedule 仍收 notes 并在内部按引用缓存预处理结果。
export interface UseAudioOptions {
  answerSoundPath?: string;
  initialVolume?: number;
  initialTimingOffset?: number;
  autoInit?: boolean;
}

export interface UseAudioReturn {
  init: () => Promise<void>;
  resume: () => Promise<void>;
  schedule: (
    notes: Note[] | null,
    currentTimeMs: number,
    playbackSpeed?: number,
    lookAheadMs?: number,
  ) => void;
  reset: (currentTimeMs?: number, stopStartedSources?: boolean) => void;
  isInitialized: boolean;
  config: AudioConfig;
  setEnabled: (enabled: boolean) => void;
  setHoldEndSoundEnabled: (enabled: boolean) => void;
  setTouchSoundEnabled: (enabled: boolean) => void;
  setVolume: (volume: number) => void;
  setTimingOffset: (offsetMs: number) => void;
}

const defaultConfig: AudioConfig = {
  enabled: false,
  holdEndSoundEnabled: true,
  touchSoundEnabled: true,
  volume: 0.5,
  timingOffsetMs: ANSWER_SOUND_BASE_OFFSET_MS,
};

export function useAudio(options: UseAudioOptions = {}): UseAudioReturn {
  const { autoInit = false, ...managerConfig } = options;
  const managerRef = useRef<AudioManager | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const managerConfigRef = useRef(managerConfig);
  const autoInitRef = useRef(autoInit);
  // 按 notes 数组引用缓存 prepareAudioEvents 结果，避免每帧重算（长谱昂贵）。
  const preparedRef = useRef<{ notes: Note[] | null; events: PreparedAudioEvent[] }>({
    notes: null,
    events: [],
  });
  const [isInitialized, setIsInitialized] = useState(false);
  const [config, setConfig] = useState<AudioConfig>(defaultConfig);

  useEffect(() => {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextClass();
    const outputNode = ctx.createGain();
    outputNode.connect(ctx.destination);
    audioContextRef.current = ctx;
    // Safari/iOS：context 创建即 suspended，注册到手势解锁（点播放等手势内 resume）。
    const unregisterUnlock = registerAudioContextForUnlock(ctx);

    const manager = new AudioManager({ audioContext: ctx, outputNode, ...managerConfigRef.current });
    managerRef.current = manager;

    if (autoInitRef.current) {
      // init() 期间若 StrictMode 立刻卸载：cleanup 关闭 ctx，进行中的 decodeAudioData
      // 会 reject 并被 AudioManager.init 内部 try/catch 吞掉（不再需要旧的 init 竞态守卫）。
      manager.init().then(() => {
        if (managerRef.current !== manager) return;
        setIsInitialized(manager.isInitialized());
        setConfig(manager.getConfig());
      });
    }

    return () => {
      unregisterUnlock();
      manager.dispose();
      managerRef.current = null;
      preparedRef.current = { notes: null, events: [] };
      audioContextRef.current = null;
      void ctx.close().catch(() => {});
    };
  }, []);

  const init = useCallback(async () => {
    const manager = managerRef.current;
    if (!manager) return;
    await manager.init();
    setIsInitialized(manager.isInitialized());
    setConfig(manager.getConfig());
  }, []);

  const resume = useCallback(async () => {
    const ctx = audioContextRef.current;
    if (ctx && ctx.state === "suspended") {
      await ctx.resume();
    }
  }, []);

  const schedule = useCallback(
    (notes: Note[] | null, currentTimeMs: number, playbackSpeed?: number, lookAheadMs?: number) => {
      const manager = managerRef.current;
      if (!manager) return;
      const cache = preparedRef.current;
      if (cache.notes !== notes) {
        cache.notes = notes;
        cache.events = prepareAudioEvents(notes);
      }
      manager.schedule(cache.events, currentTimeMs, playbackSpeed, lookAheadMs);
    },
    [],
  );

  const reset = useCallback((currentTimeMs?: number, stopStartedSources?: boolean) => {
    managerRef.current?.reset(currentTimeMs, stopStartedSources);
  }, []);

  const updateConfig = useCallback(() => {
    if (managerRef.current) setConfig(managerRef.current.getConfig());
  }, []);

  const setEnabled = useCallback(
    (enabled: boolean) => {
      managerRef.current?.setEnabled(enabled);
      updateConfig();
    },
    [updateConfig],
  );

  const setHoldEndSoundEnabled = useCallback(
    (enabled: boolean) => {
      managerRef.current?.setHoldEndSoundEnabled(enabled);
      updateConfig();
    },
    [updateConfig],
  );

  const setTouchSoundEnabled = useCallback(
    (enabled: boolean) => {
      managerRef.current?.setTouchSoundEnabled(enabled);
      updateConfig();
    },
    [updateConfig],
  );

  const setVolume = useCallback(
    (volume: number) => {
      managerRef.current?.setVolume(volume);
      updateConfig();
    },
    [updateConfig],
  );

  const setTimingOffset = useCallback(
    (offsetMs: number) => {
      managerRef.current?.setTimingOffset(offsetMs);
      updateConfig();
    },
    [updateConfig],
  );

  return {
    init,
    resume,
    schedule,
    reset,
    isInitialized,
    config,
    setEnabled,
    setHoldEndSoundEnabled,
    setTouchSoundEnabled,
    setVolume,
    setTimingOffset,
  };
}

export default useAudio;
