import { type ApiClient, okJson } from "@/shared/api-client";
import type { ChartAssetRole, PublicChartDto, PublicChartsPageDto } from "@/shared/charts";
import {publicChartSearchParams, type PublicChartFilters} from "@/shared/public-chart-search";
import type { PublicChartSearchInput } from "@/shared/public-chart-search";

export function publicChartsApi(api: ApiClient) {
  const routes = api.api.v1.charts;
  return {
    list: async (cursor?: string, limit?: number, filters: PublicChartSearchInput | PublicChartFilters = {}): Promise<PublicChartsPageDto> =>
      okJson(await routes.$get({ query: { ...(typeof filters.difficulty === "number" || Array.isArray(filters.tags) || Array.isArray(filters.levels) || typeof filters.preview === "boolean" || typeof filters.minSeconds === "number" || typeof filters.maxSeconds === "number" ? Object.fromEntries(publicChartSearchParams(filters as PublicChartFilters)) : filters as PublicChartSearchInput), ...(cursor ? { cursor } : {}), ...(limit !== undefined ? { limit: String(limit) } : {}) } }, { init: { cache: "no-store" } })),
    tags: async (q = ""): Promise<{ key: string; label: string; count: number }[]> =>
      okJson(await routes.tags.$get({ query: { q } }, { init: { cache: "no-store" } })),
    related: async (id: string): Promise<PublicChartDto[]> =>
      okJson(await routes[":id"].related.$get({ param: { id } }, { init: { cache: "no-store" } })),
    get: async (id: string): Promise<PublicChartDto> =>
      okJson(await routes[":id"].$get({ param: { id } }, { init: { cache: "no-store" } })),
  };
}
export function publicChartAssetUrl(id: string, versionId: string, role: ChartAssetRole): string {
  return `/api/v1/charts/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/assets/${role}`;
}
export function publicChartDownloadUrl(id: string): string {
  return `/api/v1/charts/${encodeURIComponent(id)}/download`;
}
