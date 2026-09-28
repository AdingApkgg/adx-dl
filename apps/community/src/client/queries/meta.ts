import { queryOptions } from "@tanstack/react-query";

import { type ApiClient, expectOk } from "@/shared/api-client";

// 服务端 loader 和组件用同一份定义，queryKey 一致，hydrate 后组件直接命中缓存。
export function metaQuery(api: ApiClient) {
  return queryOptions({
    queryKey: ["meta"] as const,
    queryFn: async () => (await expectOk(await api.api.v1.meta.$get())).json(),
  });
}
