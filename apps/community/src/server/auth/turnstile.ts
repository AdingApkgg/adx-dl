import { isIP } from "node:net";

import { describeError } from "@/shared/describe-error";
import type { Logger } from "@/shared/log";
import type { TurnstileAction } from "@/shared/turnstile-actions";

export type TurnstileVerdict = "ok" | "failed" | "unavailable";

/** remoteIp 是访客 IP，可选，Cloudflare 用它辅助判断。action 是这次的用途，要和前端渲染 widget 时给的一样。 */
export type TurnstileVerifier = (
  token: string,
  remoteIp: string | null,
  action: TurnstileAction
) => Promise<TurnstileVerdict>;

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** 发给 Turnstile 的访客 IP：Cloudflare 给的原始地址。不用 Better Auth 的 getIP：它把 IPv6 截成 /64（给限流用的）。 */
export function turnstileRemoteIp(request: Request | undefined): string | null {
  const ip = request?.headers.get("cf-connecting-ip")?.trim();
  return ip && isIP(ip) !== 0 ? ip : null;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type TurnstileOptions = {
  secretKey: string;
  log: Logger;
  /** 本站的域名（PUBLIC_ORIGIN 的主机名）。siteverify 带回的 hostname 不是它的令牌一律不认。 */
  expectedHostname: string;
  /** 测试里指向本机起的假服务。 */
  siteverifyUrl?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
};

// QQ 发码和"只用通行密钥注册"共用（本计划"与 spec 的偏离"第 3 条）。
// 令牌 5 分钟有效、只能验证一次：前端每次提交前都要拿一个新令牌。
export function createTurnstileVerifier(options: TurnstileOptions): TurnstileVerifier {
  const url = options.siteverifyUrl ?? SITEVERIFY_URL;
  const timeoutMs = options.timeoutMs ?? 8000;
  const send: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));

  return async (token, remoteIp, action) => {
    // 真令牌最长 2048 个字符（Cloudflare 文档），空的和更长的不必发出去。
    if (!token || token.length > 2048) {
      return "failed";
    }
    try {
      const res = await send(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: options.secretKey, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        options.log.error("turnstile_unavailable", { status: res.status });
        return "unavailable";
      }
      const body = (await res.json()) as {
        success?: unknown;
        hostname?: unknown;
        action?: unknown;
        metadata?: { result_with_testing_key?: unknown };
      };
      if (body.success !== true) {
        return "failed";
      }
      // Cloudflare 的测试密钥（本机开发和测试用）总是回 hostname example.com、没有 action，并标上这一项：不核对。
      // 线上用的是真实密钥，Cloudflare 不会这样标。
      if (body.metadata?.result_with_testing_key === true) {
        return "ok";
      }
      // 同一个站点密钥挂在别的网站上拿到的令牌、给另一种用途拿的令牌，都不认（Cloudflare 文档建议核对这两项）。
      if (body.hostname !== options.expectedHostname || body.action !== action) {
        options.log.error("turnstile_mismatch", {
          hostname: String(body.hostname),
          action: String(body.action),
          expectedAction: action,
        });
        return "failed";
      }
      return "ok";
    } catch (error) {
      options.log.error("turnstile_unavailable", describeError(error));
      return "unavailable";
    }
  };
}
