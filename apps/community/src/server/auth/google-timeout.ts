import { withTimeout } from "../with-timeout";
import type { Auth } from "./auth";

/** 线上换 Google 令牌最多等这么久。g510 经本机的代理连 Google，正常 1–2 秒（2026-10-06 实测）。 */
export const GOOGLE_TOKEN_TIMEOUT_MS = 10_000;

// Google 登录的回调里，Better Auth 1.7.6 用 code 去换令牌（POST https://oauth2.googleapis.com/token），这一步
// 没有超时，也没有给它留配置项。g510 在国内，代理出了问题时请求会一直挂着，用户停在回调页上等（1b 走查时每次卡
// 约 75 秒才失败）。所以在建好 auth 之后，把 Google 这个 provider 的 validateAuthorizationCode 包一层：
// 到时间没换到就抛错，Better Auth 照常按"换令牌失败"处理（记日志，跳回登录页并带上 error=invalid_code）。
// 原来的请求不会被取消，只是不再等它。回调每次都从 auth 的 context 里取这个 provider 对象，改它就生效：
// 已对照 Better Auth 1.7.6 的 api/routes/callback.mjs 核实，google-timeout.test.ts 守着。
export async function limitGoogleTokenExchange(auth: Auth, timeoutMs = GOOGLE_TOKEN_TIMEOUT_MS): Promise<void> {
  const context = await auth.$context;
  const google = context.socialProviders.find((provider) => provider.id === "google");
  if (!google) {
    throw new Error("Better Auth has no google provider");
  }
  const exchange = google.validateAuthorizationCode.bind(google);
  google.validateAuthorizationCode = (data) => withTimeout(exchange(data), timeoutMs);
}
