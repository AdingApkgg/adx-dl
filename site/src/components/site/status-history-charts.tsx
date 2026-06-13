"use client";

import { useSyncExternalStore } from "react";

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
          <CardDescription>{labels.cpuTrendLabel}</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          {isMounted ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={288}>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timeLabel" />
                <YAxis />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="cpuPercent"
                  stroke="#8b5cf6"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="memoryPercent"
                  stroke="#06b6d4"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="diskPercent"
                  stroke="#f59e0b"
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
          <CardDescription>{labels.uploadSpeedTrendLabel}</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          {isMounted ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={288}>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timeLabel" />
                <YAxis />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="uploadSpeed"
                  stroke="#22c55e"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="downloadSpeed"
                  stroke="#ef4444"
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
