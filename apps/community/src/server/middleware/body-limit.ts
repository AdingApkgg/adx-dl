import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

// 选项和 Hono 的 bodyLimit 一样，但只限制声明了请求体的请求：带 Content-Length 或 Transfer-Encoding。HTTP/1.1 的
// 请求两个头都没有就没有请求体（RFC 9112 第 6.3 节），这样的请求原样放行。开发服务器里 @hono/node-server 的请求垫片
// 对没有请求体的 DELETE 也给一个空的请求体流，bodyLimit 见到有请求体流又没有长度，就读空它、换一个新的 Request，
// 新 Request 丢了方法，DELETE 变成 GET。
export function bodyLimitWhenDeclared(options: Parameters<typeof bodyLimit>[0]): MiddlewareHandler {
  const limit = bodyLimit(options);
  return async (c, next) => {
    const { headers } = c.req.raw;
    if (!headers.has("content-length") && !headers.has("transfer-encoding")) {
      await next();
      return;
    }
    return limit(c, next);
  };
}
