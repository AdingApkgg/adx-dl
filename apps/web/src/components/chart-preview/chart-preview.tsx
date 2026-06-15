"use client";

import { useEffect } from "react";
import {
  getAvailableDifficulties,
  type ChartDifficulty,
} from "@lxns-network/maimai-chart-engine";
import { ChartCanvas } from "./chart-canvas";
import { ChartControls } from "./chart-controls";
import { useGameStore } from "./store/game-store";
import { applyDifficulty } from "./apply-difficulty";

export type ChartPreviewProps = {
  /** URL to the simai `maidata.txt`. */
  maidataUrl: string;
  /** URL to the song audio (`track.mp3`); slaved as the master clock. */
  audioUrl?: string;
  /** Preferred difficulty (catalog slot 2–6 == engine ChartDifficulty). */
  defaultDifficulty?: number;
};

export function ChartPreview({ maidataUrl, audioUrl, defaultDifficulty }: ChartPreviewProps) {
  useEffect(() => {
    let cancelled = false;
    const { setMusicUrl, setRawSimaiText, setAvailableDifficulties, reset } =
      useGameStore.getState();

    if (audioUrl) setMusicUrl(audioUrl);

    (async () => {
      try {
        const response = await fetch(maidataUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const simai = await response.text();
        if (cancelled) return;

        setRawSimaiText(simai);
        const available = getAvailableDifficulties(simai);
        setAvailableDifficulties(available);

        const preferred = defaultDifficulty as ChartDifficulty | undefined;
        let diff: ChartDifficulty | null =
          preferred && available[preferred] ? preferred : null;
        if (!diff) {
          const highest = (Object.keys(available) as unknown as string[])
            .map(Number)
            .filter((d) => available[d as ChartDifficulty])
            .sort((a, b) => b - a)[0];
          diff = (highest as ChartDifficulty) ?? null;
        }
        if (diff) applyDifficulty(diff);
      } catch (error) {
        console.error("Failed to load chart:", error);
      }
    })();

    return () => {
      cancelled = true;
      reset();
    };
  }, [maidataUrl, audioUrl, defaultDifficulty]);

  return (
    <div className="flex flex-col gap-4">
      <ChartCanvas />
      <ChartControls />
    </div>
  );
}

export default ChartPreview;
