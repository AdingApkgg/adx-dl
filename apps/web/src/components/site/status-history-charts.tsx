"use client";

import * as React from "react";
import { useSyncExternalStore, type CSSProperties } from "react";
import { useReducedMotion } from "framer-motion";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AnimatePresence, EASE_OUT, motion } from "@/components/motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDictionary, type Locale } from "@/lib/i18n";
import type { ServerStatusHistoryPoint } from "@/lib/server-status-history";

type StatusHistoryChartsProps = {
  locale?: Locale;
  history: ServerStatusHistoryPoint[];
};

// Recharts takes inline styles, not classes, so route every color through the
// design tokens to keep both themes readable (its defaults are light-only).
const AXIS_TICK_STYLE = { fill: "var(--muted-foreground)", fontSize: 12 };
const TOOLTIP_CONTENT_STYLE: CSSProperties = {
  backgroundColor: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
};
const TOOLTIP_LABEL_STYLE: CSSProperties = { color: "var(--popover-foreground)" };
const TOOLTIP_CURSOR = { stroke: "var(--border)" };

function subscribe() {
  return () => {};
}

/**
 * Draw-in wipe for a freshly revealed chart card: a card-colored overlay
 * shrinks away to the left (scaleX 1→0, origin-right), exposing the already
 * final chart underneath — Recharts' own animation stays off. The overlay
 * unmounts once the wipe completes and never renders under reduced motion or
 * when the card was already in the first paint.
 */
function WipeReveal({
  active,
  delay = 0,
  children,
}: {
  active: boolean;
  delay?: number;
  children: React.ReactNode;
}) {
  const [done, setDone] = React.useState(false);
  const reduced = useReducedMotion();
  const showOverlay = active && !done && !reduced;

  return (
    <div className="relative">
      {children}
      {showOverlay ? (
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 z-10 rounded-xl bg-card"
          style={{ transformOrigin: "right" }}
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT, delay }}
          onAnimationComplete={() => setDone(true)}
        />
      ) : null}
    </div>
  );
}

export function StatusHistoryCharts({
  locale = "zh",
  history,
}: StatusHistoryChartsProps) {
  const labels = getDictionary(locale).statusPage;
  const isMounted = useSyncExternalStore(subscribe, () => true, () => false);
  const hasEnoughHistory = history.length >= 2;
  // Which branch this instance first rendered with (captured once, on mount):
  // the wipe must only play when the charts replace the waiting card
  // client-side, never over prerendered chart markup (which has to be readable
  // as-is).
  const [initialBranch] = React.useState<"charts" | "waiting">(
    hasEnoughHistory ? "charts" : "waiting"
  );
  const wipeActive = initialBranch === "waiting";

  // initial={false}: whichever branch is in the first render (and thus the
  // prerendered HTML) appears at full opacity; only the later waiting→charts
  // handoff crossfades.
  return (
    <AnimatePresence mode="wait" initial={false}>
      {!hasEnoughHistory ? (
        <motion.div
          key="waiting"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE_OUT }}
        >
          <Card>
            <CardHeader>
              <CardTitle>{labels.resourceChartsTitle}</CardTitle>
              <CardDescription>{labels.waitingForHistory}</CardDescription>
            </CardHeader>
          </Card>
        </motion.div>
      ) : (
        <motion.div
          key="charts"
          className="grid gap-6 xl:grid-cols-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE_OUT }}
        >
          <WipeReveal active={wipeActive}>
            <Card>
              <CardHeader>
                <CardTitle>{labels.resourceChartsTitle}</CardTitle>
                <CardDescription>{labels.resourceChartsDescription}</CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                {isMounted ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={288}>
                    <LineChart data={history}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="timeLabel" stroke="var(--border)" tick={AXIS_TICK_STYLE} />
                      <YAxis stroke="var(--border)" tick={AXIS_TICK_STYLE} />
                      <Tooltip
                        contentStyle={TOOLTIP_CONTENT_STYLE}
                        labelStyle={TOOLTIP_LABEL_STYLE}
                        cursor={TOOLTIP_CURSOR}
                      />
                      <Line
                        type="monotone"
                        dataKey="cpuPercent"
                        name={labels.cpuLabel}
                        stroke="var(--chart-1)"
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="memoryPercent"
                        name={labels.memoryLabel}
                        stroke="var(--chart-2)"
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="diskPercent"
                        name={labels.diskLabel}
                        stroke="var(--chart-3)"
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full rounded-lg bg-muted/30" aria-hidden="true" />
                )}
              </CardContent>
            </Card>
          </WipeReveal>

          <WipeReveal active={wipeActive} delay={0.15}>
            <Card>
              <CardHeader>
                <CardTitle>{labels.networkChartsTitle}</CardTitle>
                <CardDescription>{labels.networkChartsDescription}</CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                {isMounted ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={288}>
                    <LineChart data={history}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="timeLabel" stroke="var(--border)" tick={AXIS_TICK_STYLE} />
                      <YAxis stroke="var(--border)" tick={AXIS_TICK_STYLE} />
                      <Tooltip
                        contentStyle={TOOLTIP_CONTENT_STYLE}
                        labelStyle={TOOLTIP_LABEL_STYLE}
                        cursor={TOOLTIP_CURSOR}
                      />
                      <Line
                        type="monotone"
                        dataKey="uploadSpeed"
                        name={labels.uploadSpeedLabel}
                        stroke="var(--chart-4)"
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="downloadSpeed"
                        name={labels.downloadSpeedLabel}
                        stroke="var(--chart-5)"
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full rounded-lg bg-muted/30" aria-hidden="true" />
                )}
              </CardContent>
            </Card>
          </WipeReveal>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
