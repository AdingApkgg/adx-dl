"use client";

import dynamic from "next/dynamic";
import type { ChartPreviewProps } from "./chart-preview";

// The player is canvas + Web Audio + localStorage only — never server-render it.
// Under `output: export` this renders nothing on the server and mounts on the
// client, so it adds no prerendered markup and no hydration mismatch.
const ChartPreview = dynamic(() => import("./chart-preview").then((m) => m.ChartPreview), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col gap-4">
      <div className="mx-auto aspect-square w-full max-w-[600px] animate-pulse rounded-lg bg-muted" />
      <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
    </div>
  ),
});

export function ChartPreviewIsland(props: ChartPreviewProps) {
  return <ChartPreview {...props} />;
}

export default ChartPreviewIsland;
