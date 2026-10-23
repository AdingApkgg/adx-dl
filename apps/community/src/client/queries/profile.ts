import { queryOptions } from "@tanstack/react-query";

import { type ApiClient, okJson } from "@/shared/api-client";

// 用户编号隔离账号切换前的缓存；仍挂在 ["me"] 下面，修改资料后可一起刷新。
export function profileQuery(api: ApiClient, userId: string) {
  return queryOptions({
    queryKey: ["me", "profile", userId] as const,
    queryFn: async () => okJson(await api.api.v1.me.profile.$get()),
  });
}
