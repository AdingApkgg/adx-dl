import { parseSimaiChart, type ChartDifficulty } from "@lxns-network/maimai-chart-engine";
import { useGameStore, playbackTimeRef } from "./store/game-store";

/** Re-parse the raw simai for a difficulty and load it into the store. Shared by
 *  the initial load (ChartPreview) and the difficulty buttons (ChartControls). */
export function applyDifficulty(diff: ChartDifficulty): void {
  const { rawSimaiText, setSelectedDifficulty, setChartData } = useGameStore.getState();
  if (!rawSimaiText) return;
  try {
    setSelectedDifficulty(diff);
    setChartData(parseSimaiChart(rawSimaiText, diff));
    playbackTimeRef.current = 0;
  } catch (error) {
    console.error("Failed to parse chart:", error);
  }
}
