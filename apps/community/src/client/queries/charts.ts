import { queryOptions } from "@tanstack/react-query";
import { type ApiClient, expectOk, okJson } from "@/shared/api-client";
import type { ChartAssetRole, ChartDto, ChartsPageDto } from "@/shared/charts";
import { replayRequest } from "./storage";

export type ChartPatch = { expectedRevision: number; title?: string; artist?: string; currentVersionId?: string };
export function chartsApi(api: ApiClient) {
  const routes = api.api.v1.me.charts;
  const json = (body: unknown, signal?: AbortSignal) => ({ init: {
    headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal,
  } });
  return {
    list: async (cursor?: string, signal?: AbortSignal): Promise<ChartsPageDto> =>
      okJson(await routes.$get({ query: { ...(cursor ? { cursor } : {}) } }, { init: { signal } })),
    get: async (id: string, signal?: AbortSignal): Promise<ChartDto> =>
      okJson(await routes[":id"].$get({ param: { id } }, { init: { signal } })),
    create: (fileId: string): Promise<ChartDto> =>
      replayRequest(async () => okJson(await routes.$post(undefined, json({ fileId })))),
    append: (id: string, fileId: string, expectedRevision: number): Promise<ChartDto> =>
      replayRequest(async () => okJson(await routes[":id"].versions.$post({ param: { id } }, json({ fileId, expectedRevision })))),
    // PATCH is never automatically replayed after an ambiguous response; the editor fetches current state.
    patch: async (id: string, body: ChartPatch): Promise<ChartDto> =>
      okJson(await routes[":id"].$patch({ param: { id } }, json(body))),
    // Publication mutations must be reconciled with GET, never automatically replayed.
    publish: async (id: string, expectedRevision: number, versionId: string): Promise<ChartDto> =>
      okJson(await routes[":id"].publication.$put({ param: { id } }, json({ expectedRevision, versionId, confirmOriginalArchive: true }))),
    withdraw: async (id: string, expectedRevision: number): Promise<ChartDto> =>
      okJson(await routes[":id"].publication.$delete({ param: { id } }, json({ expectedRevision }))),
    remove: async (id: string, expectedRevision: number): Promise<void> => {
      await replayRequest(async () => expectOk(await routes[":id"].$delete({ param: { id } }, json({ expectedRevision }))));
    },
    removeVersion: async (id: string, versionId: string, expectedRevision: number): Promise<void> => {
      await replayRequest(async () => expectOk(await routes[":id"].versions[":versionId"].$delete({ param: { id, versionId } }, json({ expectedRevision }))));
    },
  };
}
export const chartsQuery = (api: ApiClient, cursor?: string) => queryOptions({
  queryKey: ["me", "charts", "list", cursor ?? null] as const,
  queryFn: ({ signal }) => chartsApi(api).list(cursor, signal),
});
export const chartQuery = (api: ApiClient, id: string) => queryOptions({
  queryKey: ["me", "charts", id] as const,
  queryFn: ({ signal }) => chartsApi(api).get(id, signal),
});
export function chartAssetUrl(id: string, versionId: string, role: ChartAssetRole): string {
  return `/api/v1/me/charts/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/assets/${role}`;
}
