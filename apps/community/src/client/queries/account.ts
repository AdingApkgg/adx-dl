import { queryOptions } from "@tanstack/react-query";

import { type ApiClient, expectOk } from "@/shared/api-client";

export function loginsQuery(api: ApiClient) {
  return queryOptions({
    queryKey: ["me", "logins"] as const,
    queryFn: async () => (await expectOk(await api.api.v1.me.logins.$get())).json(),
  });
}

export function sessionsQuery(api: ApiClient) {
  return queryOptions({
    queryKey: ["me", "sessions"] as const,
    queryFn: async () => (await expectOk(await api.api.v1.me.sessions.$get())).json(),
  });
}
