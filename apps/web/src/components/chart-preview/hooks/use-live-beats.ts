"use client";

import { useEffect, useState } from "react";
import { useGameStore, playbackTimeRef } from "../store/game-store";

/** While playing, the authoritative time lives in playbackTimeRef (updated each
 *  frame by ChartCanvas), not in the store — so poll it via rAF for a live
 *  readout. While paused, return the store's preciseTime. */
export function useLiveBeats(): number {
  const isPlaying = useGameStore((s) => s.isPlaying);
  const preciseTime = useGameStore((s) => s.timeline.preciseTime);
  const [playingBeats, setPlayingBeats] = useState(0);

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      setPlayingBeats(playbackTimeRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  return isPlaying ? playingBeats : preciseTime;
}
