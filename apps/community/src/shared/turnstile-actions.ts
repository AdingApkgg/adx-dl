// Turnstile 的两种用途（spec 第 10.1 节）。前端渲染 widget 时把它作为 action 交给 Cloudflare，服务端校验时核对
// siteverify 带回来的 action：一种用途拿到的令牌不能拿去做另一件事。Cloudflare 要求最多 32 个字母、数字、_ 或 -。
export const TURNSTILE_ACTIONS = {
  qqSendCode: "qq-send-code",
  passkeySignUp: "passkey-sign-up",
} as const;

export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[keyof typeof TURNSTILE_ACTIONS];
