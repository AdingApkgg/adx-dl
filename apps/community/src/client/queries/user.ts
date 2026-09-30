import { queryOptions } from "@tanstack/react-query";

import { type ApiClient, okJson } from "@/shared/api-client";

// 个人主页的公开资料；用户不存在（或者 id 格式不对）时是 null，页面据此返回 404。
export function userQuery(api: ApiClient, id: string) {
  return queryOptions({
    queryKey: ["users", id] as const,
    queryFn: async () => {
      // id 来自网址：路由参数已经解码，Hono 客户端又把路径参数原样拼进地址、不转义。URL 解析器把 "\" 当成
      // "/"，"..\me\profile" 就会请求到 /api/v1/me/profile，"?" 会带出查询串；服务端渲染时这个请求还带着
      // 访问者的 Cookie。先编码，"\"、"/"、"?" 都只是 /api/v1/users/ 后面这一段里的普通字符。
      const res = await api.api.v1.users[":id"].$get({ param: { id: encodeURIComponent(id) } });
      if (res.status === 404) {
        return null;
      }
      return okJson(res);
    },
  });
}
