"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { ChartPreviewIsland } from "./chart-preview-island";
import type { ChartPreviewProps } from "./chart-preview";
import { readPreviewDifficulty } from "@/lib/chart-preview-route";

/** Parent Suspense keeps search state out of the statically exported page body. */
export function ChartPreviewRoutePlayer(props: ChartPreviewProps) {
  const params = useSearchParams();
  const difficulty = readPreviewDifficulty(new URLSearchParams(params.toString()));
  const syncDifficulty = useCallback((slot: number) => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("diff") === String(slot)) return;
    url.searchParams.set("diff", String(slot));
    // Passing Next internal history flags would bypass its search-param sync.
    window.history.replaceState(null, "", url);
  }, []);
  return <ChartPreviewIsland {...props} defaultDifficulty={difficulty ?? props.defaultDifficulty} onDifficultyChange={syncDifficulty} deferUntilNearViewport={false} />;
}
