"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  DOWNLOAD_SOURCES,
  getDownloadSource,
  isCustomDownloadSourceId,
  type CustomDownloadSourceConfig,
  type DownloadSource,
  type DownloadSourceId,
} from "@/lib/download-sources";
import type { DownloadSourceProbe } from "@/lib/download-source-probe";
import type { SiteDictionary } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useDownloadsStore } from "./downloads-store";

type SourcePickerCopy = SiteDictionary["downloads"]["sourcePicker"];
export const IDLE_DOWNLOAD_SOURCE_PROBE: DownloadSourceProbe = {
  state: "idle",
  latencyMs: null,
  measuredAt: null,
};

export function configuredDownloadSources(
  customSources: readonly CustomDownloadSourceConfig[]
): DownloadSource[] {
  return [
    ...DOWNLOAD_SOURCES,
    ...customSources.map((source) =>
      getDownloadSource(source.id, source.baseUrl, source.name)
    ),
  ];
}

export function downloadSourceStatusClass(
  source: DownloadSource,
  probe: DownloadSourceProbe
): string {
  if (isCustomDownloadSourceId(source.id) && source.baseUrl === "") {
    return "bg-muted-foreground/40";
  }
  if (
    source.status === "maintenance" ||
    probe.state === "timeout" ||
    probe.state === "error"
  ) {
    return "bg-destructive";
  }
  if (probe.latencyMs !== null) {
    if (probe.latencyMs <= 200) {
      return "bg-emerald-500";
    }
    if (probe.latencyMs <= 500) {
      return "bg-amber-500";
    }
    return "bg-orange-500";
  }
  return probe.state === "testing"
    ? "bg-primary animate-pulse"
    : "bg-muted-foreground/40";
}

export function downloadSourceCopy(
  source: DownloadSource,
  copy: SourcePickerCopy
): { name: string; description: string } {
  if (isCustomDownloadSourceId(source.id)) {
    return {
      name: source.name ?? copy.options.custom.name,
      description: source.baseUrl || copy.options.custom.description,
    };
  }
  return copy.options[source.copyKey];
}

export function downloadSourceBadge(
  source: DownloadSource,
  copy: SourcePickerCopy
): string {
  return copy.badges[source.role];
}

export function downloadSourceStatusText(
  source: DownloadSource,
  probe: DownloadSourceProbe,
  copy: SourcePickerCopy
): string {
  if (isCustomDownloadSourceId(source.id) && source.baseUrl === "") {
    return copy.probe.unconfigured;
  }
  if (source.status === "maintenance") {
    return copy.statuses.maintenance;
  }
  if (probe.latencyMs !== null) {
    return `${probe.latencyMs} ms`;
  }
  switch (probe.state) {
    case "idle":
      return copy.probe.idle;
    case "testing":
      return copy.probe.testing;
    case "timeout":
      return copy.probe.timeout;
    case "error":
      return copy.probe.unavailable;
    case "ok":
      return copy.probe.idle;
  }
}

function useDownloadSourceProbes() {
  const sourceProbes = useDownloadsStore((state) => state.sourceProbes);
  const refreshSourceProbes = useDownloadsStore(
    (state) => state.refreshSourceProbes
  );
  React.useEffect(() => {
    void refreshSourceProbes();
  }, [refreshSourceProbes]);
  return sourceProbes;
}

export function DownloadSourceSummary({
  sourceId,
  sourceBaseUrl,
  sourceName,
  copy,
  className,
}: {
  sourceId: string;
  sourceBaseUrl?: string;
  sourceName?: string;
  copy: SourcePickerCopy;
  className?: string;
}) {
  const customSources = useDownloadsStore((state) => state.customSources);
  const configured = customSources.find((source) => source.id === sourceId);
  const source = getDownloadSource(
    sourceId,
    sourceBaseUrl ?? configured?.baseUrl,
    sourceName ?? configured?.name
  );
  const sourceProbes = useDownloadSourceProbes();
  // A job keeps the old URL after a route is edited or deleted. Its historical
  // snapshot must not borrow the live route's new latency.
  const canUseLiveProbe =
    !isCustomDownloadSourceId(source.id) ||
    configured?.baseUrl === source.baseUrl;
  const probe = canUseLiveProbe
    ? sourceProbes[source.id] ?? IDLE_DOWNLOAD_SOURCE_PROBE
    : IDLE_DOWNLOAD_SOURCE_PROBE;
  const option = downloadSourceCopy(source, copy);
  const badge = downloadSourceBadge(source, copy);
  const status = downloadSourceStatusText(source, probe, copy);
  const customUrl =
    isCustomDownloadSourceId(source.id) && source.baseUrl !== ""
      ? source.baseUrl
      : null;
  const ariaLabel = [
    `${copy.label}: ${option.name}`,
    badge,
    ...(customUrl ? [customUrl] : []),
    status,
  ].join(", ");

  return (
    <span
      data-download-source={source.id}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          downloadSourceStatusClass(source, probe)
        )}
      />
      <span className="truncate font-medium text-foreground/80">
        {option.name}
      </span>
      <Badge
        variant={source.role === "primary" ? "secondary" : "outline"}
        className="h-4 px-1.5 text-[10px] leading-none"
      >
        {badge}
      </Badge>
      {customUrl ? (
        <span className="max-w-40 truncate" title={customUrl}>
          {customUrl}
        </span>
      ) : null}
      <span className="shrink-0">{status}</span>
    </span>
  );
}

export function DownloadSourceMenu({
  value,
  sourceBaseUrl,
  onValueChange,
  copy,
  hint,
}: {
  value: DownloadSourceId;
  /** Current job snapshot; distinguishes an edited route from its old task. */
  sourceBaseUrl?: string;
  onValueChange: (value: DownloadSourceId) => void;
  copy: SourcePickerCopy;
  hint?: string;
}) {
  const sourceProbes = useDownloadSourceProbes();
  const customSources = useDownloadsStore((state) => state.customSources);
  const sources = configuredDownloadSources(customSources);
  const configuredCurrent = customSources.find((source) => source.id === value);
  const radioValue =
    sourceBaseUrl !== undefined &&
    isCustomDownloadSourceId(value) &&
    configuredCurrent?.baseUrl !== sourceBaseUrl
      ? "__historical-source-snapshot__"
      : value;

  return (
    <>
      <DropdownMenuLabel>{copy.label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={radioValue}
        onValueChange={(next) => {
          const source = sources.find((candidate) => candidate.id === next);
          if (source) {
            onValueChange(source.id);
          }
        }}
      >
        {sources.map((source) => {
          const option = downloadSourceCopy(source, copy);
          const badge = downloadSourceBadge(source, copy);
          const probe =
            sourceProbes[source.id] ?? IDLE_DOWNLOAD_SOURCE_PROBE;
          const status = downloadSourceStatusText(source, probe, copy);
          return (
            <DropdownMenuRadioItem
              key={source.id}
              value={source.id}
              disabled={source.status === "maintenance"}
              onSelect={(event) => event.preventDefault()}
              className="items-start py-2"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                  downloadSourceStatusClass(source, probe)
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{option.name}</span>
                  <Badge
                    variant={
                      source.role === "primary" ? "secondary" : "outline"
                    }
                    className="h-4 px-1.5 text-[10px] leading-none"
                  >
                    {badge}
                  </Badge>
                  <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
                    {status}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                  {option.description}
                </span>
              </span>
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
      {customSources.length === 0 ? (
        <p className="px-2 pt-1.5 text-xs leading-relaxed text-muted-foreground">
          {copy.manageInSettings}
        </p>
      ) : null}
      {hint ? (
        <p
          role="note"
          className="px-2 pt-1.5 text-xs leading-relaxed text-muted-foreground"
        >
          {hint}
        </p>
      ) : null}
    </>
  );
}
