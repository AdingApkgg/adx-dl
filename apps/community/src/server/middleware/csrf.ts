import type { MiddlewareHandler } from "hono";

import { jsonError } from "../errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// 不用 hono/csrf：它只检查表单类的 Content-Type，对 JSON 请求直接放行，也不看
// Sec-Fetch-Site。这里的规则见 spec 第 8.1 节第 10 条。
export function csrfGuard({ publicOrigin }: { publicOrigin: string }): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) {
      await next();
      return;
    }
    if (/^Bearer\s/i.test(c.req.header("authorization") ?? "")) {
      await next();
      return;
    }

    const contentType = c.req.header("content-type") ?? "";
    if (!/^application\/json(\s*;|$)/i.test(contentType)) {
      return jsonError(c, 415, "UNSUPPORTED_MEDIA_TYPE", "State-changing requests must send application/json");
    }
    if (c.req.header("origin") !== publicOrigin) {
      return jsonError(c, 403, "CSRF_ORIGIN_MISMATCH", "Origin does not match this site");
    }
    // 浏览器带了才检查：Safari 16.4 之前不发这个头，上面的 Origin 校验已经够用。
    const fetchSite = c.req.header("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin") {
      return jsonError(c, 403, "CSRF_CROSS_SITE", "Cross-site request rejected");
    }
    await next();
  };
}
