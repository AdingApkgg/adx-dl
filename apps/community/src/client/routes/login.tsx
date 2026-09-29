import { dehydrate, HydrationBoundary, useQuery } from "@tanstack/react-query";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { redirect, useSearchParams } from "react-router";

import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { NICKNAME_MAX, normalizeNickname } from "@/shared/nickname";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { QqCodeForm } from "../components/qq-code-form";
import { authClient } from "../lib/auth-client";
import { errorCodeOf, errorMessage } from "../lib/auth-errors";
import { getRenderApi } from "../lib/browser";
import { safeNextPath } from "../lib/next-path";
import { welcomeHref } from "../lib/require-user";
import { canonicalLink, localeAlternates, originFrom } from "../lib/seo";
import { useTurnstile } from "../lib/turnstile";
import { loginOptionsQuery } from "../queries/login-options";
import { meQuery } from "../queries/me";
import type { Route } from "./+types/login";

export async function loader({ context, url }: Route.LoaderArgs) {
  const queryClient = context.get(queryClientContext);
  const api = context.get(apiContext);
  const [me] = await Promise.all([queryClient.query(meQuery(api)), queryClient.query(loginOptionsQuery(api))]);
  // 已经登录就直接回去；"重新登录"（reauth=1）例外：用户要的正是一个刚创建的会话。
  if (me && url.searchParams.get("reauth") !== "1") {
    throw redirect(safeNextPath(url.searchParams.get("next"), localizeHref("/")));
  }
  return { dehydratedState: dehydrate(queryClient) };
}

export function meta({ matches, location }: Route.MetaArgs) {
  const origin = originFrom(matches);
  return [
    { title: `${m.login_title()} - ${m.site_name()}` },
    { name: "description", content: m.login_description() },
    { name: "robots", content: "noindex" },
    canonicalLink(origin, location.pathname),
    ...localeAlternates(origin, location.pathname),
  ];
}

export default function Login({ loaderData }: Route.ComponentProps) {
  return (
    <HydrationBoundary state={loaderData.dehydratedState}>
      <LoginContent />
    </HydrationBoundary>
  );
}

function LoginContent() {
  const { data: options } = useQuery(loginOptionsQuery(getRenderApi()));
  const [params] = useSearchParams();
  const next = safeNextPath(params.get("next"), localizeHref("/"));
  const callbackError = params.get("error");
  const callbackMessage = callbackError ? errorMessage(callbackError) : null;
  // 登录成功一律整页跳转：服务端渲染要带着新会话重新取数据。
  const go = useCallback((isNewUser: boolean) => window.location.assign(isNewUser ? welcomeHref() : next), [next]);

  if (!options) {
    return null;
  }
  return (
    <main>
      <h1>{m.login_title()}</h1>
      {params.get("reauth") === "1" ? <p>{m.login_reauth_notice()}</p> : null}
      {callbackMessage ? <p role="alert">{callbackMessage}</p> : null}

      <GoogleSignIn next={next} />

      <section>
        <h2>{m.login_qq_heading()}</h2>
        {options.qq.available ? (
          <>
            <p>{options.qq.botQq ? m.login_qq_add_bot({ bot: options.qq.botQq }) : m.login_qq_console_hint()}</p>
            <QqCodeForm
              siteKey={options.turnstileSiteKey}
              intent="login"
              webauthnAutofill
              onVerified={({ isNewUser }) => go(isNewUser)}
            />
          </>
        ) : (
          <p>{m.login_qq_unavailable()}</p>
        )}
      </section>

      <PasskeySection siteKey={options.turnstileSiteKey} onSignedIn={go} />
    </main>
  );
}

function GoogleSignIn({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);
    // 整页跳到 Google；回来时 Better Auth 按新老用户跳到不同的地址，出错时回到本页并带 ?error=。
    const res = await authClient.signIn.social({
      provider: "google",
      callbackURL: next,
      newUserCallbackURL: welcomeHref(),
      errorCallbackURL: localizeHref("/login"),
    });
    if (res.error) {
      setPending(false);
      setError(errorMessage(res.error));
    }
  }

  return (
    <section>
      <button type="button" disabled={pending} onClick={signIn}>
        {pending ? m.login_working() : m.login_google()}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

async function conditionalMediationAvailable(): Promise<boolean> {
  const credential = typeof window === "undefined" ? undefined : window.PublicKeyCredential;
  if (!credential || typeof credential.isConditionalMediationAvailable !== "function") {
    return false;
  }
  // 官方文档的示例漏了 await：Promise 永远是真值（调研报告第 2.4 节）。
  return credential.isConditionalMediationAvailable();
}

// 浏览器自动填充（Conditional UI）：页面加载后挂起一个请求，用户点 QQ 号输入框时浏览器列出本站的通行密钥。
function useConditionalPasskey(onSignedIn: (isNewUser: boolean) => void) {
  useEffect(() => {
    let cancelled = false;
    async function arm() {
      if (!(await conditionalMediationAvailable())) {
        return;
      }
      const res = await authClient.signIn.passkey({ autoFill: true });
      if (cancelled) {
        return;
      }
      if (res.data) {
        onSignedIn(false);
        return;
      }
      // 挑战 5 分钟过期后重新挂起。用户改点"用通行密钥登录"按钮时这里会收到取消，忽略。
      if (errorCodeOf(res.error) === "CHALLENGE_NOT_FOUND") {
        void arm();
      }
    }
    void arm();
    return () => {
      cancelled = true;
    };
  }, [onSignedIn]);
}

function PasskeySection({ siteKey, onSignedIn }: { siteKey: string; onSignedIn: (isNewUser: boolean) => void }) {
  const turnstile = useTurnstile(siteKey);
  const [nickname, setNickname] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useConditionalPasskey(onSignedIn);

  async function signIn() {
    setPending(true);
    setError(null);
    const res = await authClient.signIn.passkey();
    setPending(false);
    if (res.data) {
      onSignedIn(false);
      return;
    }
    setError(errorMessage(res.error));
  }

  async function signUp(event: FormEvent) {
    event.preventDefault();
    const name = normalizeNickname(nickname);
    if (!name) {
      setError(m.error_nickname_invalid());
      return;
    }
    if (!turnstile.token) {
      return;
    }
    setPending(true);
    setError(null);
    // context 原样交给服务端的 resolveUser（昵称和人机验证在浏览器创建凭据之前校验）；
    // createSession 让注册完直接登录，并让建号走事务。不传 name：它会变成系统密码管理器里显示的账号名。
    const res = await authClient.passkey.addPasskey({
      context: JSON.stringify({ nickname: name, turnstileToken: turnstile.token }),
      createSession: true,
    });
    setPending(false);
    turnstile.reset();
    if (res?.error) {
      setError(errorMessage(res.error));
      return;
    }
    onSignedIn(true);
  }

  return (
    <section>
      <h2>{m.login_passkey_heading()}</h2>
      <button type="button" disabled={pending} onClick={signIn}>
        {m.login_passkey_sign_in()}
      </button>

      <h3>{m.login_passkey_signup_heading()}</h3>
      <p>{m.login_passkey_signup_hint()}</p>
      <form onSubmit={signUp}>
        <label>
          {m.login_nickname()}{" "}
          <input
            name="nickname"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            maxLength={NICKNAME_MAX}
            required
            autoComplete="nickname"
          />
        </label>
        <div ref={turnstile.ref} />
        {turnstile.failed ? <p role="alert">{m.login_turnstile_failed()}</p> : null}
        <button type="submit" disabled={pending || !turnstile.token}>
          {pending ? m.login_working() : m.login_passkey_signup()}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
