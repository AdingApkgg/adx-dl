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

/** 限流按 IP 计数时用的键：IPv6 按 /64 合并，IPv4 原样返回（1a 评审遗留 #8）。 */
export function rateLimitKeyForIp(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1]) {
    return mapped[1];
  }
  const groups = expandIpv6(ip.split("%")[0] ?? "");
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : ip;
}

// 把 IPv6 地址展开成 8 组、去掉前导零的小写十六进制；不是合法的 IPv6 就返回 null。
function expandIpv6(address: string): string[] | null {
  if (!address.includes(":")) {
    return null;
  }
  const halves = address.split("::");
  if (halves.length > 2) {
    return null;
  }
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) {
    return null;
  }
  const filler = Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0");
  const groups = [...head, ...filler, ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) {
    return null;
  }
  return groups.map((group) => Number.parseInt(group, 16).toString(16));
}
