import { type ApiClient, okJson } from "@/shared/api-client";
import type { DashReportsPage, ReportResolutionInput, ReportResolutionResult } from "@/shared/community-social";
import type { DashAccess, DashOverview, DashUsersPage, DashChartsPage, DashStatus, DashChart, DashModerateInput } from "@/shared/dash";

/** Never share/cache administrative data between navigations or accounts. */
export function dashApi(api: ApiClient) {
  const routes = api.api.v1.dash;
  const fresh = { init: { cache: "no-store" as const } };
  return {
    access: async (): Promise<DashAccess> => okJson(await routes.access.$get(undefined, fresh)),
    overview: async (): Promise<DashOverview> => okJson(await routes.overview.$get(undefined, fresh)),
    users: async (cursor?: string): Promise<DashUsersPage> => okJson(await routes.users.$get({ query: { limit: "24", ...(cursor ? { cursor } : {}) } }, fresh)),
    charts: async (cursor?: string): Promise<DashChartsPage> => okJson(await routes.charts.$get({ query: { limit: "24", ...(cursor ? { cursor } : {}) } }, fresh)),
    reports: async (status = "open", cursor?: string, ticket?: string): Promise<DashReportsPage> => okJson(await routes.reports.$get({ query: { status, ...(cursor ? { cursor } : {}), ...(ticket ? {ticket} : {}) } }, fresh)),
    resolveReport: async (id: string, input: ReportResolutionInput): Promise<ReportResolutionResult> => okJson(await routes.reports[":id"].resolution.$post({ param: { id }, json: input }, fresh)),
    status: async (): Promise<DashStatus> => okJson(await routes.status.$get(undefined, fresh)),
    moderate: async (id: string, input: DashModerateInput): Promise<DashChart> => okJson(await routes.charts[":id"].moderation.$post({ param: { id }, json: input }, fresh)),
  };
}
