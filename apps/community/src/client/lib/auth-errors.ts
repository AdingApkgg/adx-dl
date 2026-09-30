import { m } from "@/paraglide/messages.js";
import { ApiError } from "@/shared/api-client";

// 接口和 Better Auth 都只返回错误码，前端翻译成当前语言（spec 第 11.1 节）。
const MESSAGES: Record<string, () => string> = {
  REAUTH_REQUIRED: m.error_reauth_required,
  SESSION_NOT_FRESH: m.error_reauth_required,
  LAST_LOGIN_METHOD: m.error_last_login_method,
  QQ_CAPTCHA_FAILED: m.error_captcha_failed,
  SIGNUP_CAPTCHA_FAILED: m.error_captcha_failed,
  QQ_CAPTCHA_UNAVAILABLE: m.error_captcha_unavailable,
  SIGNUP_CAPTCHA_UNAVAILABLE: m.error_captcha_unavailable,
  QQ_SEND_RATE_LIMITED: m.error_qq_send_rate_limited,
  QQ_CODE_EXPIRED: m.error_qq_code_expired,
  QQ_CODE_INVALID: m.error_qq_code_invalid,
  QQ_CODE_TOO_MANY_ATTEMPTS: m.error_qq_code_too_many_attempts,
  QQ_ALREADY_LINKED: m.error_qq_already_linked,
  QQ_LINK_REQUIRES_SESSION: m.error_sign_in_required,
  UNAUTHORIZED: m.error_sign_in_required,
  SIGNUP_INVALID: m.error_nickname_invalid,
  PASSKEY_NOT_FOUND: m.error_passkey_not_found,
  ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED: m.error_passkey_already_registered,
  CURRENT_SESSION: m.error_current_session,
  RATE_LIMITED: m.error_rate_limited,
  account_already_linked_to_different_user: m.error_google_already_linked,
  NICKNAME_INVALID: m.error_nickname_invalid,
  BIO_TOO_LONG: m.error_bio_too_long,
  ACCOUNT_PENDING_DELETION: m.error_account_pending_deletion,
  DELETION_CONFIRM_MISMATCH: m.error_deletion_confirm_mismatch,
  DELETION_NOT_CANCELLABLE: m.error_deletion_not_cancellable,
};

// 用户自己关掉了通行密钥对话框，或者在 Google 那边点了取消：不算错误。
// ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY 是 @simplewebauthn/browser 对 NotAllowedError 的包装：用户点"取消"、
// 超时、浏览器不允许，这几种情况浏览器自己已经提示过用户，页面不用再提示一遍。通行密钥客户端把它原样
// 交出来（signIn.passkey 和 addPasskey 都是）；AUTH_CANCELLED 只在抛出的不是 WebAuthn 错误时才出现。
const SILENT = new Set([
  "AUTH_CANCELLED",
  "ERROR_CEREMONY_ABORTED",
  "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
  "access_denied",
]);

/** 错误码：Better Auth 客户端的 { code }、我们接口的 ApiError，或者地址里 ?error= 的字符串。 */
export function errorCodeOf(error: unknown): string | undefined {
  if (typeof error === "string") {
    return error || undefined;
  }
  if (error instanceof ApiError) {
    return error.code;
  }
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

/** 给用户看的一句话；用户自己取消的返回 null，不用提示。 */
export function errorMessage(error: unknown): string | null {
  const code = errorCodeOf(error);
  if (code && SILENT.has(code)) {
    return null;
  }
  // 只认 MESSAGES 自己的键：?error= 来自地址，"constructor"、"__proto__" 这样的名字不能顺着原型链查到东西。
  const known = code && Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : undefined;
  if (known) {
    return known();
  }
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  if (status === 429) {
    return m.error_rate_limited();
  }
  // Google 回调出错时 Better Auth 在地址里带小写的错误码（state_mismatch、unable_to_create_user 等）。
  if (code && /^[a-z_]+$/.test(code)) {
    return m.error_google_failed();
  }
  return m.error_unknown();
}
