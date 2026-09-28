import type { QueryClient } from "@tanstack/react-query";

import { type ApiClient, createApiClient } from "@/shared/api-client";
import { makeQueryClient } from "@/shared/query-client";

let queryClient: QueryClient | undefined;
let api: ApiClient | undefined;

// 浏览器里只有一个 QueryClient：clientLoader 预取的数据和组件读的是同一份缓存。
export function getBrowserQueryClient(): QueryClient {
  queryClient ??= makeQueryClient();
  return queryClient;
}

export function getBrowserApi(): ApiClient {
  api ??= createApiClient(window.location.origin);
  return api;
}

// 服务端渲染时 useQuery 不会真的发请求（数据已经由 loader 预取好），这个客户端
// 只是为了拼出同样的查询定义，所以指向一个永远用不到的地址。
const renderPlaceholderApi = createApiClient("http://render-placeholder.invalid");

export function getRenderApi(): ApiClient {
  return typeof window === "undefined" ? renderPlaceholderApi : getBrowserApi();
}
