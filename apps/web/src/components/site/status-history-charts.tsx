"use client";

import { useSyncExternalStore, type CSSProperties } from "react";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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

export function StatusHistoryCharts({
  locale = "zh",
  history,
}: StatusHistoryChartsProps) {
  const labels = getDictionary(locale).statusPage;
  const isMounted = useSyncExternalStore(subscribe, () => true, () => false);

  if (history.length < 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{labels.resourceChartsTitle}</CardTitle>
          <CardDescription>{labels.waitingForHistory}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
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
    </div>
  );
}
