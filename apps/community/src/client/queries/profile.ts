import { queryOptions } from "@tanstack/react-query";

import { type ApiClient, okJson } from "@/shared/api-client";

// 自己的资料（昵称、简介、引导页看过没有）。键挂在 ["me"] 下面：改了资料、退出登录后让 ["me"] 失效时一起刷新。
export function profileQuery(api: ApiClient) {
  return queryOptions({
    queryKey: ["me", "profile"] as const,
    queryFn: async () => okJson(await api.api.v1.me.profile.$get()),
  });
}
