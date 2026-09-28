import { describeError } from "@/shared/describe-error";
import type { Logger } from "@/shared/log";

export type TurnstileVerdict = "ok" | "failed" | "unavailable";

/** remoteIp 是访客 IP，可选，Cloudflare 用它辅助判断。 */
export type TurnstileVerifier = (token: string, remoteIp: string | null) => Promise<TurnstileVerdict>;

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type TurnstileOptions = {
  secretKey: string;
  log: Logger;
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

  return async (token, remoteIp) => {
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
      const body = (await res.json()) as { success?: unknown };
      return body.success === true ? "ok" : "failed";
    } catch (error) {
      options.log.error("turnstile_unavailable", describeError(error));
      return "unavailable";
    }
  };
}
