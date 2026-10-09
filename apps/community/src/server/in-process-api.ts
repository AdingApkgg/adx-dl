import type { Context } from "hono";

import { type ApiClient, createApiClient } from "@/shared/api-client";

export type InProcessApp = {
  request(input: RequestInfo | URL, init?: RequestInit, env?: unknown): Response | Promise<Response>;
};

// 进程内请求交给 app.request 的第三个参数，Hono 把它放在 c.env 上。经网络来的请求，c.env 是 Bun 的服务器对象；
// 外面的人构造不出这个对象，所以凭它认出进程内请求是可靠的（请求头做不到：谁都能带）。
export const IN_PROCESS_ENV: Readonly<{ inProcess: true }> = Object.freeze({ inProcess: true });

/** 这个请求是不是服务端渲染时 loader 经进程内 API 发的。 */
export function isInProcessRequest(c: Context): boolean {
  return c.env === IN_PROCESS_ENV;
}

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
// 接口响应里的 Set-Cookie（会话满一天时的续期）浏览器收不到，逐条交给 onSetCookie，由页面响应带回去。
export function createInProcessApi(
  app: InProcessApp,
  incoming: Request,
  meta: InProcessRequestMeta,
  onSetCookie: (cookie: string) => void
): ApiClient {
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
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await app.request(input, init, IN_PROCESS_ENV);
      for (const cookie of res.headers.getSetCookie()) {
        onSetCookie(cookie);
      }
      return res;
    },
    headers,
  });
}
