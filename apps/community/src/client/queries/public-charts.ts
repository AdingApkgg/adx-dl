import { type ApiClient, okJson } from "@/shared/api-client";
import type { ChartAssetRole, PublicChartDto, PublicChartsPageDto } from "@/shared/charts";

export function publicChartsApi(api: ApiClient) {
  const routes = api.api.v1.charts;
  return {
    list: async (cursor?: string): Promise<PublicChartsPageDto> =>
      okJson(await routes.$get({ query: { ...(cursor ? { cursor } : {}) } }, { init: { cache: "no-store" } })),
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
