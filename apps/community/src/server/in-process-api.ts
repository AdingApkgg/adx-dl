import { type ApiClient, createApiClient } from "@/shared/api-client";

export type InProcessApp = {
  request(input: RequestInfo | URL, init?: RequestInit): Response | Promise<Response>;
};

export type InProcessRequestMeta = {
  /** 站点对外地址，拼接口的完整地址用。 */
  origin: string;
  /** 本次页面请求的 ID（requestId 中间件生成的）。 */
  requestId: string;
  /** clientIp 中间件已经解析好的访客 IP。 */
  clientIp: string;
};

const FORWARDED_HEADERS = ["cookie", "authorization", "accept-language", "user-agent"];

// 服务端渲染时 loader 用它调自己的 API：请求直接交给 app.request，不走网络，
// 走的是和浏览器完全相同的接口代码和鉴权逻辑（spec 第 8.3 节）。
export function createInProcessApi(app: InProcessApp, incoming: Request, meta: InProcessRequestMeta): ApiClient {
  // 请求 ID 和 IP 不从原请求头里抄：真正用的请求 ID 是中间件生成的，原请求头里
  // 至多有一个访客自己带的；IP 也用解析好的，开发环境没有 CF-Connecting-IP 时一样对得上。
  const headers: Record<string, string> = {
    "x-request-id": meta.requestId,
    "cf-connecting-ip": meta.clientIp,
  };
  for (const name of FORWARDED_HEADERS) {
    const value = incoming.headers.get(name);
    if (value) {
      headers[name] = value;
    }
  }
  return createApiClient(meta.origin, {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
    headers,
  });
}
