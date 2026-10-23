import { queryOptions } from "@tanstack/react-query";

import { type ApiClient, expectOk } from "@/shared/api-client";

export function loginsQuery(api: ApiClient, userId: string) {
  return queryOptions({
    queryKey: ["me", "logins", userId] as const,
    queryFn: async () => (await expectOk(await api.api.v1.me.logins.$get())).json(),
  });
}

export function sessionsQuery(api: ApiClient, userId: string) {
  return queryOptions({
    queryKey: ["me", "sessions", userId] as const,
    queryFn: async () => (await expectOk(await api.api.v1.me.sessions.$get())).json(),
  });
}
