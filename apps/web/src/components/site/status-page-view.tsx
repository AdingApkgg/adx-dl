import { ExternalLinkIcon, RefreshCcwIcon, ServerIcon } from "lucide-react";

import { StatusHistoryCharts } from "@/components/site/status-history-charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDictionary, type Locale } from "@/lib/i18n";
import type { ServerStatusHistoryPoint } from "@/lib/server-status-history";
import { STATUS_SOURCE_URL, type ServerStatusSnapshot } from "@/lib/server-status";

type StatusPageViewProps = {
  locale?: Locale;
  snapshot: ServerStatusSnapshot | null;
  history: ServerStatusHistoryPoint[];
  isRefreshing: boolean;
  errorMessage: string | null;
  onRefresh?: () => void;
};

function DisplayValue({ value, fallback }: { value: string | null; fallback: string }) {
  return <span>{value ?? fallback}</span>;
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
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm font-medium">
        <DisplayValue value={value} fallback={fallback} />
      </CardContent>
    </Card>
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
        <h1 className="text-3xl font-semibold">{labels.title}</h1>
        <p className="text-muted-foreground">{labels.description}</p>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" onClick={onRefresh}>
            <RefreshCcwIcon data-icon="inline-start" />
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
      </section>

      <StatusHistoryCharts locale={locale} history={history} />

      {snapshot ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <MetricCard label={labels.overviewTitle} value={snapshot.name} fallback={labels.unavailable} />
            <MetricCard label={labels.stateLabel} value={snapshot.state} fallback={labels.unavailable} />
            <MetricCard label={labels.regionLabel} value={snapshot.region} fallback={labels.unavailable} />
            <MetricCard label={labels.systemLabel} value={snapshot.system} fallback={labels.unavailable} />
            <MetricCard label={labels.archLabel} value={snapshot.arch} fallback={labels.unavailable} />
            <MetricCard label={labels.lastReportLabel} value={snapshot.lastReportTime} fallback={labels.unavailable} />
            <MetricCard label={labels.loadLabel} value={snapshot.load} fallback={labels.unavailable} />
          </section>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <MetricCard label={labels.resourcesTitle} value={snapshot.cpuModel} fallback={labels.unavailable} />
            <MetricCard label={labels.cpuLabel} value={snapshot.cpuPercent} fallback={labels.unavailable} />
            <MetricCard label={labels.memoryLabel} value={snapshot.memoryUsageText} fallback={labels.unavailable} />
            <MetricCard label={labels.swapLabel} value={snapshot.swapUsageText} fallback={labels.unavailable} />
            <MetricCard label={labels.diskLabel} value={snapshot.diskUsageText} fallback={labels.unavailable} />
            <MetricCard label={labels.processLabel} value={snapshot.processCount} fallback={labels.unavailable} />
          </section>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <MetricCard label={labels.networkTitle} value={snapshot.uptime} fallback={labels.unavailable} />
            <MetricCard label={labels.uploadTotalLabel} value={snapshot.uploadTotal} fallback={labels.unavailable} />
            <MetricCard label={labels.downloadTotalLabel} value={snapshot.downloadTotal} fallback={labels.unavailable} />
            <MetricCard label={labels.uploadSpeedLabel} value={snapshot.uploadSpeed} fallback={labels.unavailable} />
            <MetricCard label={labels.downloadSpeedLabel} value={snapshot.downloadSpeed} fallback={labels.unavailable} />
            <MetricCard label={labels.tcpLabel} value={snapshot.tcpCount} fallback={labels.unavailable} />
            <MetricCard label={labels.udpLabel} value={snapshot.udpCount} fallback={labels.unavailable} />
          </section>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{labels.title}</CardTitle>
            <CardDescription>{labels.description}</CardDescription>
          </CardHeader>
          <CardContent>{errorMessage ?? labels.loading}</CardContent>
        </Card>
      )}
    </main>
  );
}
