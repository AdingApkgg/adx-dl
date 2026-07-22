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
  type DownloadSource,
  type DownloadSourceId,
} from "@/lib/download-sources";
import type { DownloadSourceProbe } from "@/lib/download-source-probe";
import type { SiteDictionary } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useDownloadsStore } from "./downloads-store";

type SourcePickerCopy = SiteDictionary["downloads"]["sourcePicker"];

export function downloadSourceStatusClass(
  source: DownloadSource,
  probe: DownloadSourceProbe
): string {
  if (source.status === "maintenance" || probe.state === "timeout" || probe.state === "error") {
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
    ? "bg-primary animate-pulse motion-reduce:animate-none"
    : "bg-muted-foreground/40";
}

function sourceCopy(source: DownloadSource, copy: SourcePickerCopy) {
  return copy.options[source.copyKey];
}

function sourceBadge(source: DownloadSource, copy: SourcePickerCopy): string {
  return copy.badges[source.role];
}

export function downloadSourceStatusText(
  source: DownloadSource,
  probe: DownloadSourceProbe,
  copy: SourcePickerCopy
): string {
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
  const refreshSourceProbes = useDownloadsStore((state) => state.refreshSourceProbes);
  React.useEffect(() => {
    void refreshSourceProbes();
  }, [refreshSourceProbes]);
  return sourceProbes;
}

export function DownloadSourceSummary({
  sourceId,
  copy,
  className,
}: {
  sourceId: string;
  copy: SourcePickerCopy;
  className?: string;
}) {
  const source = getDownloadSource(sourceId);
  const sourceProbes = useDownloadSourceProbes();
  const probe = sourceProbes[source.id];
  const option = sourceCopy(source, copy);
  const badge = sourceBadge(source, copy);
  const status = downloadSourceStatusText(source, probe, copy);

  return (
    <span
      data-download-source={source.id}
      aria-label={`${copy.label}: ${option.name}, ${badge}, ${status}`}
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
      <span className="truncate font-medium text-foreground/80">{option.name}</span>
      <Badge
        variant={source.role === "primary" ? "secondary" : "outline"}
        className="h-4 px-1.5 text-[10px] leading-none"
      >
        {badge}
      </Badge>
      <span className="shrink-0">{status}</span>
    </span>
  );
}

export function DownloadSourceMenu({
  value,
  onValueChange,
  copy,
  hint,
}: {
  value: DownloadSourceId;
  onValueChange: (value: DownloadSourceId) => void;
  copy: SourcePickerCopy;
  hint?: string;
}) {
  const sourceProbes = useDownloadSourceProbes();

  return (
    <>
      <DropdownMenuLabel>{copy.label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={value}
        onValueChange={(next) => onValueChange(getDownloadSource(next).id)}
      >
        {DOWNLOAD_SOURCES.map((source) => {
          const option = sourceCopy(source, copy);
          const badge = sourceBadge(source, copy);
          const probe = sourceProbes[source.id];
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
                  <span className="font-medium">{option.name}</span>
                  <Badge
                    variant={source.role === "primary" ? "secondary" : "outline"}
                    className="h-4 px-1.5 text-[10px] leading-none"
                  >
                    {badge}
                  </Badge>
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    {status}
                  </span>
                </span>
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  {option.description}
                </span>
              </span>
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
      {hint ? (
        <p role="note" className="px-2 pt-1.5 text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </>
  );
}
