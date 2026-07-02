"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import type { ChartPreviewProps } from "./chart-preview";

// The player is canvas + Web Audio + localStorage only — never server-render it.
// Under `output: export` this renders nothing on the server and mounts on the
// client, so it adds no prerendered markup and no hydration mismatch.
const ChartPreview = dynamic(() => import("./chart-preview").then((m) => m.ChartPreview), {
  ssr: false,
  loading: () => <ChartPreviewPlaceholder />,
});

function ChartPreviewPlaceholder() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="mx-auto aspect-square w-full max-w-[600px] rounded-lg" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

export function ChartPreviewIsland(props: ChartPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Defer the whole player (engine chunk, canvas, chart fetch) until the card
  // scrolls near the viewport; until then only the placeholder is mounted.
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    if (nearViewport) return;
    const el = hostRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // No IO support: mount immediately — intentional external capability
      // check, not a render-derived value.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [nearViewport]);

  return (
    <div ref={hostRef}>
      {nearViewport ? <ChartPreview {...props} /> : <ChartPreviewPlaceholder />}
    </div>
  );
}

export default ChartPreviewIsland;
