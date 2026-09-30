import { queryOptions } from "@tanstack/react-query";

import { type ApiClient, okJson } from "@/shared/api-client";

// 个人主页的公开资料；用户不存在（或者 id 格式不对）时是 null，页面据此返回 404。
export function userQuery(api: ApiClient, id: string) {
  return queryOptions({
    queryKey: ["users", id] as const,
    queryFn: async () => {
      const res = await api.api.v1.users[":id"].$get({ param: { id } });
      if (res.status === 404) {
        return null;
      }
      return okJson(res);
    },
  });
}
