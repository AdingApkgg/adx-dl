import { queryOptions } from "@tanstack/react-query";
import { type ApiClient, okJson } from "@/shared/api-client";
import type { FavoritesPage, FavoriteState, MyReportsPage, MyReport, ReportInput } from "@/shared/community-social";
export function socialApi(api: ApiClient) {
  const favorites = api.api.v1.me.favorites, reports = api.api.v1.me.reports;
  const fresh = { init: { cache: "no-store" as const } };
  const write = { ...fresh, headers: { "content-type": "application/json" } };
  return {
    favorites: async (cursor?: string): Promise<FavoritesPage> => okJson(await favorites.$get({ query: { ...(cursor ? { cursor } : {}) } }, fresh)),
    favorite: async (id: string): Promise<FavoriteState> => okJson(await favorites[":id"].$get({ param: { id } }, fresh)),
    addFavorite: async (id: string): Promise<FavoriteState> => okJson(await favorites[":id"].$put({ param: { id } }, write)),
    removeFavorite: async (id: string): Promise<FavoriteState> => okJson(await favorites[":id"].$delete({ param: { id } }, write)),
    reports: async (cursor?: string): Promise<MyReportsPage> => okJson(await reports.$get({ query: { ...(cursor ? { cursor } : {}) } }, fresh)),
    report: async (id: string, input: ReportInput): Promise<MyReport> => okJson(await reports[":id"].$post({ param: { id }, json: input }, fresh)),
  };
}
export function favoriteQuery(api: ApiClient, userId: string, id: string) {
  return queryOptions({ queryKey: ["favorite", userId, id] as const, staleTime: 0, retry: false, queryFn: () => socialApi(api).favorite(id) });
}
