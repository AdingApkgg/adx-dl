import { parseSimaiChart, type ChartDifficulty } from "@lxns-network/maimai-chart-engine";
import { useGameStore, playbackTimeRef } from "./store/game-store";
import { beatsToMs, msToBeats } from "./lib/time-conversion";

/** Re-parse the raw simai for a difficulty and load it into the store. Shared by
 *  the initial load (ChartPreview) and the difficulty buttons (ChartControls). */
export function applyDifficulty(diff: ChartDifficulty): void {
  const { rawSimaiText, setSelectedDifficulty, setChartData, chartData } = useGameStore.getState();
  if (!rawSimaiText) return;
  try {
    // Keep the playhead across difficulty switches: capture the position in ms
    // (beat coordinates differ per chart), restore after loading the new chart.
    const currentMs = chartData
      ? beatsToMs(playbackTimeRef.current, chartData.bpmEvents, chartData.bpm)
      : 0;

    setSelectedDifficulty(diff);
    const nextChart = parseSimaiChart(rawSimaiText, diff);
    setChartData(nextChart);
    playbackTimeRef.current = 0;

    if (currentMs > 0) {
      const state = useGameStore.getState();
      const totalBeats = state.timeline.totalMeasures * state.timeline.beatsPerMeasure;
      const totalMs = beatsToMs(totalBeats, nextChart.bpmEvents, nextChart.bpm);
      const beats = msToBeats(Math.min(currentMs, totalMs), nextChart.bpmEvents, nextChart.bpm);
      playbackTimeRef.current = beats;
      state.setPreciseTime(beats, true);
    }
  } catch (error) {
    console.error("Failed to parse chart:", error);
  }
}
