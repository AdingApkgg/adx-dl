import { queryOptions } from "@tanstack/react-query";

import { type ApiClient, expectOk } from "@/shared/api-client";

// 当前用户；未登录时是 null（不当成错误，页面据此显示"登录"）。
export function meQuery(api: ApiClient) {
  return queryOptions({
    queryKey: ["me"] as const,
    queryFn: async () => {
      const res = await api.api.v1.me.$get();
      if (res.status === 401) {
        return null;
      }
      return (await expectOk(res)).json();
    },
  });
}
