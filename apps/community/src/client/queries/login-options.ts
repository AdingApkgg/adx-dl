import { queryOptions } from "@tanstack/react-query";

import { type ApiClient, expectOk } from "@/shared/api-client";

export function loginOptionsQuery(api: ApiClient) {
  return queryOptions({
    queryKey: ["login-options"] as const,
    queryFn: async () => (await expectOk(await api.api.v1["login-options"].$get())).json(),
  });
}
