import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/bun";

import type { AppEnv } from "../app-env";

// 生产环境只有 cloudflared 能连进来（端口只绑本机），所以 CF-Connecting-IP 可信。
export function clientIp(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const forwarded = c.req.header("cf-connecting-ip")?.trim();
    c.set("clientIp", forwarded || socketAddress(c) || "unknown");
    await next();
  };
}

function socketAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}
