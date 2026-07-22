import type { ChartDownloadSpec } from "@/lib/catalog-shared";
import { CHART_MEDIA_ORIGIN } from "@/lib/chart-media";

export type DownloadSourceStatus = "available" | "degraded" | "maintenance";
export type DownloadSourceRole = "primary" | "backup";
export type DownloadSourceCopyKey = "r2" | "alice" | "g510" | "g400s";

type DownloadSourceConfig = {
  id: string;
  copyKey: DownloadSourceCopyKey;
  role: DownloadSourceRole;
  status: DownloadSourceStatus;
  /** Mirror root. All four routes expose the same chart-media path structure. */
  baseUrl: string;
};

const DOWNLOAD_SOURCE_PROBE_PATH = "/0/10/track.mp3";
/** Jobs saved before the mirror migration can still contain this dead origin. */
const LEGACY_DOWNLOAD_SOURCE_ORIGINS = ["https://adxcs.saop.cc"] as const;

/**
 * Download routes are intentionally data-driven. Adding another CDN or mirror
 * only requires one config entry (plus its localized name); the single-chart
 * and every batch-download surface consume this same list.
 */
export const DOWNLOAD_SOURCES = [
  {
    id: "r2",
    copyKey: "r2" as DownloadSourceCopyKey,
    role: "primary" as DownloadSourceRole,
    status: "available" as DownloadSourceStatus,
    baseUrl: "https://astrodx-charts.saop.cc",
  },
  {
    id: "alice",
    copyKey: "alice" as DownloadSourceCopyKey,
    role: "backup" as DownloadSourceRole,
    status: "available" as DownloadSourceStatus,
    baseUrl: "https://astrodx-charts-alice.saop.cc",
  },
  {
    id: "g510",
    copyKey: "g510" as DownloadSourceCopyKey,
    role: "backup" as DownloadSourceRole,
    status: "available" as DownloadSourceStatus,
    baseUrl: "https://astrodx-charts-g510.saop.cc",
  },
  {
    id: "g400s",
    copyKey: "g400s" as DownloadSourceCopyKey,
    role: "backup" as DownloadSourceRole,
    status: "available" as DownloadSourceStatus,
    baseUrl: "https://astrodx-charts-g400s.saop.cc",
  },
] as const satisfies readonly DownloadSourceConfig[];

export type DownloadSource = (typeof DOWNLOAD_SOURCES)[number];
export type DownloadSourceId = DownloadSource["id"];

export const DEFAULT_DOWNLOAD_SOURCE_ID: DownloadSourceId = "r2";

function normalizeLegacySourceId(id: string | null | undefined): string | null | undefined {
  return id === "cdn" ? "r2" : id;
}

export function getDownloadSource(id: string | null | undefined): DownloadSource {
  const normalizedId = normalizeLegacySourceId(id);
  return (
    DOWNLOAD_SOURCES.find((source) => source.id === normalizedId) ??
    DOWNLOAD_SOURCES.find((source) => source.id === DEFAULT_DOWNLOAD_SOURCE_ID) ??
    DOWNLOAD_SOURCES[0]
  );
}

/** A stale saved preference must never select a route currently marked offline. */
export function getSelectableDownloadSource(
  id: string | null | undefined
): DownloadSource {
  const requested = getDownloadSource(id);
  if (requested.status !== "maintenance") {
    return requested;
  }
  return (
    DOWNLOAD_SOURCES.find((source) => source.status !== "maintenance") ??
    requested
  );
}

function hasOrigin(url: string, origin: string): boolean {
  return url === origin || url.startsWith(`${origin}/`);
}

function downloadSourceOrigin(url: string): string | null {
  return (
    DOWNLOAD_SOURCES.find((candidate) => hasOrigin(url, candidate.baseUrl))?.baseUrl ??
    LEGACY_DOWNLOAD_SOURCE_ORIGINS.find((origin) => hasOrigin(url, origin)) ??
    null
  );
}

/**
 * Collapses every configured mirror host to the catalog origin so a whole file
 * fetched from one route can be recognised as the same logical resource after
 * switching routes. External URLs remain exact and are never conflated.
 */
export function canonicalDownloadResourceUrl(url: string): string {
  const origin = downloadSourceOrigin(url);
  return origin ? `${CHART_MEDIA_ORIGIN}${url.slice(origin.length)}` : url;
}

/**
 * Jobs saved before source routing have no source id. Infer it from rewritten
 * URLs when possible; mixed CDN/origin jobs remain the default CDN route.
 */
export function inferDownloadSourceId(
  files: readonly { url: string }[],
  persistedSourceId?: string
): DownloadSourceId {
  const normalizedId = normalizeLegacySourceId(persistedSourceId);
  const persisted = DOWNLOAD_SOURCES.find((source) => source.id === normalizedId);
  if (persisted) {
    return persisted.id;
  }

  for (const source of DOWNLOAD_SOURCES) {
    if (source.id === DEFAULT_DOWNLOAD_SOURCE_ID) {
      continue;
    }
    if (files.some((file) => hasOrigin(file.url, source.baseUrl))) {
      return source.id;
    }
  }

  return DEFAULT_DOWNLOAD_SOURCE_ID;
}

export function resolveDownloadUrl(url: string, sourceId: string): string {
  const source = getDownloadSource(sourceId);
  const origin = downloadSourceOrigin(url);
  return origin ? `${source.baseUrl}${url.slice(origin.length)}` : url;
}

export function getDownloadSourceProbeUrl(sourceId: string): string {
  return `${getDownloadSource(sourceId).baseUrl}${DOWNLOAD_SOURCE_PROBE_PATH}`;
}

/** Move a persisted job from one route to another without stacking rewrites. */
export function rerouteDownloadUrl(
  url: string,
  _fromSourceId: string,
  toSourceId: string
): string {
  return resolveDownloadUrl(url, toSourceId);
}

export function routeChartDownloadSpec(
  spec: ChartDownloadSpec,
  sourceId: string
): ChartDownloadSpec {
  return {
    ...spec,
    files: spec.files.map((file) => ({
      ...file,
      url: resolveDownloadUrl(file.url, sourceId),
    })),
  };
}

export function routeDownloadFiles<T extends { url: string }>(
  files: T[],
  sourceId: string
): T[] {
  return files.map((file) => ({
    ...file,
    url: resolveDownloadUrl(file.url, sourceId),
  }));
}

export function rerouteDownloadFiles<T extends { url: string }>(
  files: T[],
  fromSourceId: string,
  toSourceId: string
): T[] {
  return files.map((file) => ({
    ...file,
    url: rerouteDownloadUrl(file.url, fromSourceId, toSourceId),
  }));
}

export function routeChartDownloadSpecs(
  specs: ChartDownloadSpec[],
  sourceId: string
): ChartDownloadSpec[] {
  return specs.map((spec) => routeChartDownloadSpec(spec, sourceId));
}
