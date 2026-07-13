"use client";

import * as React from "react";
import { useReducedMotion } from "framer-motion";
import { ExternalLinkIcon, RefreshCcwIcon, ServerIcon } from "lucide-react";

import {
  AnimatePresence,
  EASE_OUT,
  motion,
  RevealGroup,
  RevealItem,
  springSoft,
} from "@/components/motion";
import { StatusHistoryCharts } from "@/components/site/status-history-charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getDictionary, type Locale } from "@/lib/i18n";
import type { ServerStatusHistoryPoint } from "@/lib/server-status-history";
import { STATUS_SOURCE_URL, type ServerStatusSnapshot } from "@/lib/server-status";
import { cn } from "@/lib/utils";

type StatusPageViewProps = {
  locale?: Locale;
  snapshot: ServerStatusSnapshot | null;
  history: ServerStatusHistoryPoint[];
  isRefreshing: boolean;
  errorMessage: string | null;
  onRefresh?: () => void;
};

function subscribeToVisibility(callback: () => void) {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}

// SSR snapshot is "visible" so the prerendered markup matches the common case.
function useTabVisible() {
  return React.useSyncExternalStore(
    subscribeToVisibility,
    () => document.visibilityState === "visible",
    () => true
  );
}

// The snapshot's state string is produced in Chinese ("在线"/"离线") by the API
// path, but the scrape fallback passes the monitor page's text through as-is.
const OFFLINE_STATE_PATTERN = /离线|offline|オフライン/i;

/**
 * Live-status dot beside the page title: colored by the snapshot state, with a
 * looping ping ring while online (manually gated — MotionConfig doesn't stop
 * infinite loops — and paused while the tab is hidden). The dot itself remounts
 * on every successful poll (keyed by fetchedAt) so each refresh visibly beats.
 */
function StatusHeartbeat({
  state,
  fetchedAt,
}: {
  state: string | null;
  fetchedAt: string | null;
}) {
  const reduced = useReducedMotion();
  const tabVisible = useTabVisible();
  const known = state !== null;
  const offline = known && OFFLINE_STATE_PATTERN.test(state);

  return (
    <span aria-hidden="true" className="relative inline-flex size-2.5 shrink-0">
      {known && !offline && !reduced && tabVisible ? (
        <motion.span
          className="absolute inset-0 rounded-full bg-emerald-500"
          animate={{ scale: [1, 1.9], opacity: [0.5, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
        />
      ) : null}
      <motion.span
        key={fetchedAt ?? "pending"}
        className={cn(
          "relative inline-flex size-2.5 rounded-full",
          known ? (offline ? "bg-destructive" : "bg-emerald-500") : "bg-muted-foreground/40"
        )}
        initial={{ scale: 1 }}
        animate={{ scale: [1, 1.35, 1] }}
        transition={{ duration: 0.45, ease: EASE_OUT }}
      />
    </span>
  );
}

// Bars scale relative to the window's own max CPU sample (absolute percentages
// hover near zero on an idle box, which would render an invisible strip).
const STRIP_MIN_HEIGHT_PERCENT = 18;

/**
 * Decorative sparkline of the rolling poll window under the hero: one thin bar
 * per poll, height by relative CPU load. Bars spring up staggered on first
 * paint; afterwards each new poll's bar pops in on the right while the oldest
 * exits. Purely ornamental (the same data feeds the charts), hence aria-hidden.
 */
function PollHistoryStrip({ history }: { history: ServerStatusHistoryPoint[] }) {
  // Latches after the first render that actually has bars, so the stagger
  // cascade plays exactly once (bars appended by later polls enter undelayed).
  const [cascadeDone, setCascadeDone] = React.useState(false);
  React.useEffect(() => {
    if (history.length > 0 && !cascadeDone) {
      // Intentional latch: flips once right after the cascade render commits.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCascadeDone(true);
    }
  }, [history.length, cascadeDone]);

  if (history.length === 0) {
    return null;
  }

  const maxCpu = Math.max(...history.map((point) => point.cpuPercent), 0.01);

  return (
    <div aria-hidden="true" className="flex h-6 items-end gap-1">
      <AnimatePresence>
        {history.map((point, index) => (
          <motion.span
            key={point.timestamp}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            exit={{ scaleY: 0, opacity: 0 }}
            // Stagger only the initial cascade; bars appended by later polls
            // spring in immediately.
            transition={{ ...springSoft, delay: cascadeDone ? 0 : index * 0.03 }}
            className="w-1.5 origin-bottom rounded-full bg-primary/50"
            style={{
              height: `${
                STRIP_MIN_HEIGHT_PERCENT +
                (point.cpuPercent / maxCpu) * (100 - STRIP_MIN_HEIGHT_PERCENT)
              }%`,
            }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * Rolling odometer for a metric value: keyed by the value string, the old
 * reading slides up and out while the new one rises in. `initial={false}` on
 * the presence keeps the first render (including SSR) static — the real value
 * is always in the markup and nothing animates until the first change.
 */
function DisplayValue({ value, fallback }: { value: string | null; fallback: string }) {
  const text = value ?? fallback;
  return (
    <span className="relative inline-flex max-w-full overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          className="inline-block"
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -10, opacity: 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

// Mirrors the three metric-card groups below (overview / resources / network)
// so the first load doesn't jump from a single small card to ~20 cards.
const METRIC_SKELETON_GROUP_SIZES = [7, 6, 7] as const;

function MetricsSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">{label}</span>
      {METRIC_SKELETON_GROUP_SIZES.map((size, groupIndex) => (
        <div key={groupIndex} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: size }, (_, index) => (
            <Card key={index} size="sm" className="h-full">
              <CardHeader>
                <Skeleton className="h-5 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-36" />
              </CardContent>
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}

function MetricCard({
  label,
  value,
  fallback,
}: {
  label: string;
  value: string | null;
  fallback: string;
}) {
  return (
    <RevealItem className="h-full">
      <Card size="sm" className="h-full">
        <CardHeader>
          <CardTitle className="text-base">{label}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm font-medium">
          <DisplayValue value={value} fallback={fallback} />
        </CardContent>
      </Card>
    </RevealItem>
  );
}

export function StatusPageView({
  locale = "zh",
  snapshot,
  history,
  isRefreshing,
  errorMessage,
  onRefresh,
}: StatusPageViewProps) {
  const labels = getDictionary(locale).statusPage;

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <section className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/80 p-6">
        <Badge variant="secondary" className="w-fit">
          <ServerIcon data-icon="inline-start" />
          {labels.title}
        </Badge>
        <h1 className="flex items-center gap-3 text-3xl font-semibold">
          <StatusHeartbeat
            state={snapshot?.state ?? null}
            fetchedAt={snapshot?.fetchedAt ?? null}
          />
          {labels.title}
        </h1>
        <p className="text-muted-foreground">{labels.description}</p>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" onClick={onRefresh}>
            <motion.span
              className="inline-flex"
              data-icon="inline-start"
              animate={isRefreshing ? { rotate: 360 } : { rotate: 0 }}
              transition={
                isRefreshing
                  ? { duration: 0.9, repeat: Infinity, ease: "linear" }
                  : { duration: 0.2 }
              }
            >
              <RefreshCcwIcon />
            </motion.span>
            {labels.refreshNow}
          </Button>
          <Button asChild>
            <a href={snapshot?.sourceUrl ?? STATUS_SOURCE_URL} target="_blank" rel="noreferrer">
              <ExternalLinkIcon data-icon="inline-start" />
              {labels.sourceLink}
            </a>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {isRefreshing ? labels.refreshing : labels.lastUpdated(snapshot?.fetchedAt ?? labels.unavailable)}
        </p>
        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
        <PollHistoryStrip history={history} />
      </section>

      <StatusHistoryCharts locale={locale} history={history} />

      {snapshot ? (
        <>
          <RevealGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <MetricCard label={labels.overviewTitle} value={snapshot.name} fallback={labels.unavailable} />
            <MetricCard label={labels.stateLabel} value={snapshot.state} fallback={labels.unavailable} />
            <MetricCard label={labels.regionLabel} value={snapshot.region} fallback={labels.unavailable} />
            <MetricCard label={labels.systemLabel} value={snapshot.system} fallback={labels.unavailable} />
            <MetricCard label={labels.archLabel} value={snapshot.arch} fallback={labels.unavailable} />
            <MetricCard label={labels.lastReportLabel} value={snapshot.lastReportTime} fallback={labels.unavailable} />
            <MetricCard label={labels.loadLabel} value={snapshot.load} fallback={labels.unavailable} />
          </RevealGroup>
          <RevealGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <MetricCard label={labels.resourcesTitle} value={snapshot.cpuModel} fallback={labels.unavailable} />
            <MetricCard label={labels.cpuLabel} value={snapshot.cpuPercent} fallback={labels.unavailable} />
            <MetricCard label={labels.memoryLabel} value={snapshot.memoryUsageText} fallback={labels.unavailable} />
            <MetricCard label={labels.swapLabel} value={snapshot.swapUsageText} fallback={labels.unavailable} />
            <MetricCard label={labels.diskLabel} value={snapshot.diskUsageText} fallback={labels.unavailable} />
            <MetricCard label={labels.processLabel} value={snapshot.processCount} fallback={labels.unavailable} />
          </RevealGroup>
          <RevealGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <MetricCard label={labels.networkTitle} value={snapshot.uptime} fallback={labels.unavailable} />
            <MetricCard label={labels.uploadTotalLabel} value={snapshot.uploadTotal} fallback={labels.unavailable} />
            <MetricCard label={labels.downloadTotalLabel} value={snapshot.downloadTotal} fallback={labels.unavailable} />
            <MetricCard label={labels.uploadSpeedLabel} value={snapshot.uploadSpeed} fallback={labels.unavailable} />
            <MetricCard label={labels.downloadSpeedLabel} value={snapshot.downloadSpeed} fallback={labels.unavailable} />
            <MetricCard label={labels.tcpLabel} value={snapshot.tcpCount} fallback={labels.unavailable} />
            <MetricCard label={labels.udpLabel} value={snapshot.udpCount} fallback={labels.unavailable} />
          </RevealGroup>
        </>
      ) : errorMessage ? (
        <Card>
          <CardHeader>
            <CardTitle>{labels.title}</CardTitle>
            <CardDescription>{labels.description}</CardDescription>
          </CardHeader>
          <CardContent>{errorMessage}</CardContent>
        </Card>
      ) : (
        <MetricsSkeleton label={labels.loading} />
      )}
    </main>
  );
}
