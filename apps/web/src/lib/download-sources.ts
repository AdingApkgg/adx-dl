import type { ChartDownloadSpec } from "@/lib/catalog-shared";
import { CHART_MEDIA_ORIGIN } from "@/lib/chart-media";

export type DownloadSourceStatus = "available" | "degraded" | "maintenance";
export type DownloadSourceRole = "primary" | "backup" | "custom";
export type BuiltInDownloadSourceId =
  | "r2"
  | "alice"
  | "tsumugi"
  | "awmc"
  | "g510"
  | "g400s";
export type CustomDownloadSourceId = `custom:${string}`;
/** Stable target used when migrating the old single custom-mirror setting. */
export const CUSTOM_DOWNLOAD_SOURCE_ID = "custom:legacy" as const;
export type DownloadSourceId =
  | BuiltInDownloadSourceId
  | CustomDownloadSourceId;
export type DownloadSourceCopyKey = BuiltInDownloadSourceId | "custom";

export type CustomDownloadSourceConfig = {
  id: CustomDownloadSourceId;
  name: string;
  baseUrl: string;
};

export type DownloadSource = {
  id: DownloadSourceId;
  copyKey: DownloadSourceCopyKey;
  role: DownloadSourceRole;
  status: DownloadSourceStatus;
  /** User-facing label for a custom route. Built-ins are localized by copyKey. */
  name?: string;
  /** Mirror root. Every route must expose the same chart-media path structure. */
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
    copyKey: "r2",
    role: "primary",
    status: "available" as DownloadSourceStatus,
    baseUrl: "https://astrodx-charts.saop.cc",
  },
  {
    id: "alice",
    copyKey: "alice",
    role: "backup",
    status: "available" as DownloadSourceStatus,
    baseUrl: "https://astrodx-charts-alice.saop.cc",
  },
  {
    id: "tsumugi",
    copyKey: "tsumugi",
    role: "backup",
    status: "available" as DownloadSourceStatus,
    baseUrl: "https://astrodx-charts-tsumugi.saop.cc",
  },
  {
    id: "awmc",
    copyKey: "awmc",
    role: "backup",
    status: "available" as DownloadSourceStatus,
    baseUrl: "https://astrodx-charts-wmc.saop.cc",
  },
  {
    id: "g510",
    copyKey: "g510",
    role: "backup",
    status: "available" as DownloadSourceStatus,
    baseUrl: "https://astrodx-charts-g510.saop.cc",
  },
  {
    id: "g400s",
    copyKey: "g400s",
    role: "backup",
    status: "available" as DownloadSourceStatus,
    baseUrl: "https://astrodx-charts-g400s.saop.cc",
  },
] as const satisfies readonly DownloadSource[];

export const DEFAULT_DOWNLOAD_SOURCE_ID: DownloadSourceId = "r2";

function normalizeLegacySourceId(id: string | null | undefined): string | null | undefined {
  if (id === "cdn") {
    return "r2";
  }
  return id === "custom" ? CUSTOM_DOWNLOAD_SOURCE_ID : id;
}

export function isCustomDownloadSourceId(
  id: string | null | undefined
): id is CustomDownloadSourceId {
  return Boolean(id?.startsWith("custom:") && id.length > "custom:".length);
}

export function normalizeCustomDownloadSourceName(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, 48);
  return normalized === "" ? null : normalized;
}

/**
 * Accepts an HTTPS mirror root (or local-development HTTP), including an
 * optional path prefix. Query strings, fragments and embedded credentials are
 * rejected because appending chart paths to them would be ambiguous.
 */
export function normalizeCustomDownloadSourceUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    const localHttpHost =
      url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost") ||
      url.hostname === "::1" ||
      url.hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && localHttpHost)) ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.origin === "null"
    ) {
      return null;
    }
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname === "/" ? "" : pathname}`;
  } catch {
    return null;
  }
}

export function getDownloadSource(
  id: string | null | undefined,
  customBaseUrl?: string,
  customName?: string
): DownloadSource {
  const normalizedId = normalizeLegacySourceId(id);
  if (isCustomDownloadSourceId(normalizedId)) {
    const name = normalizeCustomDownloadSourceName(customName ?? "");
    return {
      id: normalizedId,
      copyKey: "custom",
      role: "custom",
      status: "available",
      ...(name ? { name } : {}),
      baseUrl: normalizeCustomDownloadSourceUrl(customBaseUrl ?? "") ?? "",
    };
  }
  return (
    DOWNLOAD_SOURCES.find((source) => source.id === normalizedId) ??
    DOWNLOAD_SOURCES.find((source) => source.id === DEFAULT_DOWNLOAD_SOURCE_ID) ??
    DOWNLOAD_SOURCES[0]
  );
}

/** A stale saved preference must never select a route currently marked offline. */
export function getSelectableDownloadSource(
  id: string | null | undefined,
  customBaseUrl?: string,
  customName?: string
): DownloadSource {
  const requested = getDownloadSource(id, customBaseUrl, customName);
  if (
    requested.status !== "maintenance" &&
    (!isCustomDownloadSourceId(requested.id) || requested.baseUrl !== "")
  ) {
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

function downloadSourceOrigin(
  url: string,
  additionalBaseUrls: readonly string[] = []
): string | null {
  const customOrigins = additionalBaseUrls
    .map(normalizeCustomDownloadSourceUrl)
    .filter((origin): origin is string => origin !== null);
  const origins = [
    ...new Set([
      ...customOrigins,
      ...DOWNLOAD_SOURCES.map((candidate) => candidate.baseUrl),
      ...LEGACY_DOWNLOAD_SOURCE_ORIGINS,
    ]),
  ].sort((left, right) => right.length - left.length);
  return origins.find((origin) => hasOrigin(url, origin)) ?? null;
}

/**
 * Collapses every configured mirror host to the catalog origin so a whole file
 * fetched from one route can be recognised as the same logical resource after
 * switching routes. External URLs remain exact and are never conflated.
 */
export function canonicalDownloadResourceUrl(
  url: string,
  additionalBaseUrls: readonly string[] = []
): string {
  const origin = downloadSourceOrigin(url, additionalBaseUrls);
  return origin ? `${CHART_MEDIA_ORIGIN}${url.slice(origin.length)}` : url;
}

/**
 * Jobs saved before source routing have no source id. Infer it from rewritten
 * URLs when possible; mixed CDN/origin jobs remain the default CDN route.
 */
export function inferDownloadSourceId(
  files: readonly { url: string }[],
  persistedSourceId?: string,
  customBaseUrl?: string
): DownloadSourceId {
  const normalizedId = normalizeLegacySourceId(persistedSourceId);
  const normalizedCustomBaseUrl = normalizeCustomDownloadSourceUrl(
    customBaseUrl ?? ""
  );
  if (
    isCustomDownloadSourceId(normalizedId) &&
    normalizedCustomBaseUrl !== null
  ) {
    return normalizedId;
  }
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

  if (
    normalizedCustomBaseUrl !== null &&
    files.some((file) => hasOrigin(file.url, normalizedCustomBaseUrl))
  ) {
    return CUSTOM_DOWNLOAD_SOURCE_ID;
  }

  return DEFAULT_DOWNLOAD_SOURCE_ID;
}

export function resolveDownloadUrl(
  url: string,
  sourceId: string,
  customBaseUrl?: string
): string {
  const source = getSelectableDownloadSource(sourceId, customBaseUrl);
  const origin = downloadSourceOrigin(url, [source.baseUrl]);
  return origin ? `${source.baseUrl}${url.slice(origin.length)}` : url;
}

export function getDownloadSourceProbeUrl(
  sourceId: string,
  customBaseUrl?: string
): string {
  const source = getDownloadSource(sourceId, customBaseUrl);
  return source.baseUrl === ""
    ? ""
    : `${source.baseUrl}${DOWNLOAD_SOURCE_PROBE_PATH}`;
}

/** Move a persisted job from one route to another without stacking rewrites. */
export function rerouteDownloadUrl(
  url: string,
  fromSourceId: string,
  toSourceId: string,
  fromCustomBaseUrl?: string,
  toCustomBaseUrl?: string
): string {
  const fromSource = getDownloadSource(fromSourceId, fromCustomBaseUrl);
  const toSource = getSelectableDownloadSource(toSourceId, toCustomBaseUrl);
  const origin = downloadSourceOrigin(url, [
    fromCustomBaseUrl ?? "",
    toCustomBaseUrl ?? "",
    fromSource.baseUrl,
    toSource.baseUrl,
  ]);
  return origin ? `${toSource.baseUrl}${url.slice(origin.length)}` : url;
}

export function routeChartDownloadSpec(
  spec: ChartDownloadSpec,
  sourceId: string,
  customBaseUrl?: string
): ChartDownloadSpec {
  return {
    ...spec,
    files: spec.files.map((file) => ({
      ...file,
      url: resolveDownloadUrl(file.url, sourceId, customBaseUrl),
    })),
  };
}

export function routeDownloadFiles<T extends { url: string }>(
  files: T[],
  sourceId: string,
  customBaseUrl?: string
): T[] {
  return files.map((file) => ({
    ...file,
    url: resolveDownloadUrl(file.url, sourceId, customBaseUrl),
  }));
}

export function rerouteDownloadFiles<T extends { url: string }>(
  files: T[],
  fromSourceId: string,
  toSourceId: string,
  fromCustomBaseUrl?: string,
  toCustomBaseUrl?: string
): T[] {
  return files.map((file) => ({
    ...file,
    url: rerouteDownloadUrl(
      file.url,
      fromSourceId,
      toSourceId,
      fromCustomBaseUrl,
      toCustomBaseUrl
    ),
  }));
}

export function routeChartDownloadSpecs(
  specs: ChartDownloadSpec[],
  sourceId: string,
  customBaseUrl?: string
): ChartDownloadSpec[] {
  return specs.map((spec) =>
    routeChartDownloadSpec(spec, sourceId, customBaseUrl)
  );
}
