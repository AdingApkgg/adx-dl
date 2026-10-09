import { Hono } from "hono";

import type { AppEnv } from "../app-env";
import { jsonError } from "../errors";
import { bodyLimitWhenDeclared } from "./body-limit";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type UmamiProxyOptions = {
  /** Umami 在容器网络里的地址（UMAMI_INTERNAL_URL，不带末尾的斜杠）。null：没开统计，/_s/* 一律 404。 */
  internalUrl: string | null;
  /** 转发失败时调用。调用方传进来的应当已经限过频。 */
  onError: (error: unknown) => void;
  timeoutMs?: number;
  fetch?: FetchLike;
};

// 上报的请求体很小（一次页面浏览或事件，几百字节），64 KiB 和 /api/* 的上限一样。
const SEND_BODY_LIMIT = 64 * 1024;

// 浏览器发来的头只转发这几个：Umami 判断设备和机器人看 User-Agent，地区看 Cloudflare 加的 CF-IPCountry 这一组，
// 会话缓存看 x-umami-cache。Cookie、Authorization 一律不转发；True-Client-IP 这类 Umami 排在 CF-Connecting-IP
// 前面读的头也不转发，免得访客自己带一个冒充别的 IP。
const FORWARDED_REQUEST_HEADERS = [
  "content-type",
  "user-agent",
  "x-umami-cache",
  "x-umami-website-id",
  "x-umami-hostname",
  "cf-ipcountry",
  "cf-region-code",
  "cf-ipcity",
];

// spec 第 11.6 节：统计脚本和上报都走本站的 /_s/，算作本站请求，CSP 不用放行第三方域名。只转发这两个地址：
// Umami 的登录、管理接口不能经主站暴露，它的管理后台在单独的域名、放在 Cloudflare Access 后面。
// 挂在会话中间件之前（spec 第 8.1 节第 5 条）：上报不查会话，响应也不会带 Set-Cookie。
export function umamiProxy(options: UmamiProxyOptions) {
  const app = new Hono<AppEnv>();
  const { internalUrl } = options;
  const timeoutMs = options.timeoutMs ?? 5000;
  const send: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));

  if (internalUrl) {
    app.get("/script.js", async (c) => {
      const res = await forward(`${internalUrl}/script.js`, { method: "GET" });
      if (!res) {
        return jsonError(c, 502, "UPSTREAM_UNAVAILABLE", "Analytics is unavailable");
      }
      // 只带回内容的类型和缓存时间：上游的 Set-Cookie、CSP 之类不该落到本站的响应上。
      return c.body(await res.arrayBuffer(), res.status as 200, {
        "content-type": res.headers.get("content-type") ?? "text/javascript",
        "cache-control": res.headers.get("cache-control") ?? "public, max-age=3600",
      });
    });

    app.post(
      "/api/send",
      bodyLimitWhenDeclared({
        maxSize: SEND_BODY_LIMIT,
        onError: (c) => jsonError(c, 413, "PAYLOAD_TOO_LARGE", "Request body is too large"),
      }),
      async (c) => {
        const headers = new Headers();
        for (const name of FORWARDED_REQUEST_HEADERS) {
          const value = c.req.header(name);
          if (value !== undefined) {
            headers.set(name, value);
          }
        }
        // clientIp 中间件已经从 CF-Connecting-IP 解析好访客 IP（spec 第 8.1 节第 2 条）。
        headers.set("cf-connecting-ip", c.get("clientIp"));
        const res = await forward(`${internalUrl}/api/send`, {
          method: "POST",
          headers,
          body: await c.req.arrayBuffer(),
        });
        if (!res) {
          return jsonError(c, 502, "UPSTREAM_UNAVAILABLE", "Analytics is unavailable");
        }
        return c.body(await res.arrayBuffer(), res.status as 200, {
          "content-type": res.headers.get("content-type") ?? "application/json",
          "cache-control": "no-store",
        });
      }
    );
  }

  app.all("*", (c) => jsonError(c, 404, "NOT_FOUND", "Not found"));

  // 连不上、超时都返回 null，由调用方回 502。
  async function forward(url: string, init: RequestInit): Promise<Response | null> {
    try {
      return await send(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      options.onError(error);
      return null;
    }
  }

  return app;
}
