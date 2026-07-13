"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

import { AnimatePresence, EASE_OUT, motion, revealTransition } from "@/components/motion";
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

type ChartPreviewIslandProps = ChartPreviewProps & {
  deferUntilNearViewport?: boolean;
};

export function ChartPreviewIsland({
  deferUntilNearViewport = true,
  ...props
}: ChartPreviewIslandProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Defer the whole player (engine chunk, canvas, chart fetch) until the card
  // scrolls near the viewport; until then only the placeholder is mounted.
  const [nearViewport, setNearViewport] = useState(!deferUntilNearViewport);

  useEffect(() => {
    if (!deferUntilNearViewport || nearViewport) return;
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
  }, [deferUntilNearViewport, nearViewport]);

  return (
    <div ref={hostRef}>
      {/* mode="wait": the skeleton fades out fully before the player wrapper
          rises in — the canvas itself is untouched inside. initial={false}
          keeps the SSR'd skeleton (and an undeferred player) fully visible
          with no entrance state serialized into the static HTML. */}
      <AnimatePresence mode="wait" initial={false}>
        {nearViewport ? (
          <motion.div
            key="player"
            initial={{ opacity: 0, y: 12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={revealTransition}
          >
            <ChartPreview {...props} />
          </motion.div>
        ) : (
          <motion.div
            key="skeleton"
            exit={{ opacity: 0, transition: { duration: 0.2, ease: EASE_OUT } }}
          >
            <ChartPreviewPlaceholder />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ChartPreviewIsland;
