import { type FormEvent, useState } from "react";

import { m } from "@/paraglide/messages.js";
import { getLocale } from "@/paraglide/runtime.js";

import { authClient } from "../lib/auth-client";
import { errorCodeOf, errorMessage } from "../lib/auth-errors";
import { useTurnstile } from "../lib/turnstile";

export type QqCodeFormProps = {
  siteKey: string;
  /** login：登录或注册；link：给当前账号绑定 QQ。 */
  intent: "login" | "link";
  /** 登录页上打开：QQ 号输入框同时用来让浏览器列出通行密钥。 */
  webauthnAutofill?: boolean;
  /** 绑定时会话太旧（REAUTH_REQUIRED）时，错误提示后面给出的"重新登录"链接。 */
  reauthHref?: string;
  onVerified(result: { isNewUser: boolean }): void;
};

// 绑定 QQ 时会话超过 10 分钟，接口返回 REAUTH_REQUIRED（Better Auth 自己的新鲜度检查是 SESSION_NOT_FRESH）。
function isReauthError(error: unknown): boolean {
  const code = errorCodeOf(error);
  return code === "REAUTH_REQUIRED" || code === "SESSION_NOT_FRESH";
}

// spec 第 10.3 节的 QQ 流程：输入 QQ 号、过人机验证、发码，再填验证码。
export function QqCodeForm({ siteKey, intent, webauthnAutofill = false, reauthHref, onVerified }: QqCodeFormProps) {
  const turnstile = useTurnstile(siteKey);
  const [qq, setQq] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 最近一次发码或验证的错误是不是"会话太旧"：是的话，提示后面再给一个重新登录的链接。
  const [reauth, setReauth] = useState(false);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!turnstile.token) {
      return;
    }
    setPending(true);
    setError(null);
    setReauth(false);
    const res = await authClient.qq.sendCode({ qq, turnstileToken: turnstile.token, locale: getLocale() });
    setPending(false);
    // 令牌只能用一次，不管成功与否都换一个。
    turnstile.reset();
    if (res.error) {
      setError(errorMessage(res.error));
      setReauth(isReauthError(res.error));
      return;
    }
    setSent(true);
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setReauth(false);
    const res = await authClient.qq.verify({ qq, code, intent });
    setPending(false);
    if (res.error) {
      setError(errorMessage(res.error));
      setReauth(isReauthError(res.error));
      return;
    }
    onVerified({ isNewUser: "isNewUser" in res.data ? res.data.isNewUser : false });
  }

  return (
    <div>
      <form onSubmit={send}>
        <label>
          {m.login_qq_number()}{" "}
          <input
            name="qq"
            value={qq}
            onChange={(event) => setQq(event.target.value.trim())}
            inputMode="numeric"
            pattern="[1-9][0-9]{4,10}"
            required
            autoComplete={webauthnAutofill ? "username webauthn" : "off"}
          />
        </label>
        <div ref={turnstile.ref} />
        {turnstile.failed ? <p role="alert">{m.login_turnstile_failed()}</p> : null}
        <button type="submit" disabled={pending || !turnstile.token}>
          {m.login_qq_send()}
        </button>
      </form>
      {sent ? (
        <form onSubmit={verify}>
          <p>{m.login_qq_sent()}</p>
          <label>
            {m.login_qq_code()}{" "}
            <input
              name="code"
              value={code}
              onChange={(event) => setCode(event.target.value.trim())}
              inputMode="numeric"
              pattern="[0-9]{6}"
              required
              autoComplete="one-time-code"
            />
          </label>
          <button type="submit" disabled={pending}>
            {pending ? m.login_working() : m.login_qq_verify()}
          </button>
        </form>
      ) : null}
      {error ? (
        <p role="alert">
          {error}
          {reauth && reauthHref ? (
            <>
              {" "}
              <a href={reauthHref}>{m.settings_reauth()}</a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
