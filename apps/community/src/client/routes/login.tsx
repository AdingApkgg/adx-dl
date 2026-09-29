import { dehydrate, HydrationBoundary, useQuery } from "@tanstack/react-query";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
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
import { loginHref, welcomeHref } from "../lib/require-user";
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
  // loader 已经取过当前用户并 dehydrate。已登录只会出现在"重新登录"（reauth=1）时，这时不显示"只用通行密钥注册"。
  const { data: me } = useQuery(meQuery(getRenderApi()));
  const [params] = useSearchParams();
  const next = safeNextPath(params.get("next"), localizeHref("/"));
  const reauth = params.get("reauth") === "1";
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
      {reauth ? <p>{m.login_reauth_notice()}</p> : null}
      {callbackMessage ? <p role="alert">{callbackMessage}</p> : null}

      <GoogleSignIn next={next} reauth={reauth} />

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

      <PasskeySection
        siteKey={options.turnstileSiteKey}
        signedIn={Boolean(me)}
        autofill={options.qq.available}
        onSignedIn={go}
      />
    </main>
  );
}

function GoogleSignIn({ next, reauth }: { next: string; reauth: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);
    // 整页跳到 Google；回来时 Better Auth 按新老用户跳到不同的地址，出错时回到本页，并在地址后面接上 &error=。
    // 出错回来的地址要带着 next 和 reauth：否则用户再登录会落到首页而不是原来要去的页面；"重新登录"的用户已登录，
    // 少了 reauth=1，loader 会直接把他跳走，错误提示也就看不到了。
    const res = await authClient.signIn.social({
      provider: "google",
      callbackURL: next,
      newUserCallbackURL: welcomeHref(),
      errorCallbackURL: loginHref(next, reauth ? { reauth: "1" } : {}),
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

// 这几种错误都发生在用户选中通行密钥之后：挑战（5 分钟）过期了、选中的通行密钥已经被删除、验证没通过。
// 这个请求已经用掉了，要重新挂起一个。选中之前的失败（取选项时的网络错误、429、5xx）不在其中：
// 服务器不可用时重新挂起会一直循环。
const REARM_CODES = new Set(["CHALLENGE_NOT_FOUND", "PASSKEY_NOT_FOUND", "AUTHENTICATION_FAILED"]);

type ConditionalPasskeyOptions = {
  /** false 时不挂起：QQ 登录不可用时页面上没有带 webauthn 的输入框，挂起的请求只会白白用掉一个挑战和限流额度。 */
  enabled: boolean;
  onSignedIn(isNewUser: boolean): void;
  /** 登录出错时的提示；用户取消、被别的操作中止（errorMessage 返回 null）时不调用。 */
  onError(message: string): void;
};

// 浏览器自动填充（Conditional UI）：页面加载后挂起一个请求，用户点 QQ 号输入框时浏览器列出本站的通行密钥。
// 返回 rearm()：点按钮登录、通行密钥注册都会中止这个挂起的请求，它们没有成功结束（出错或用户取消）后调用它，
// 让自动填充恢复；否则自动填充要等到刷新页面才回来。
function useConditionalPasskey({ enabled, onSignedIn, onError }: ConditionalPasskeyOptions): () => void {
  // 当前这一轮 effect 里的 arm。rearm() 借它再挂起一个请求，而不是重新执行 effect：重新执行会把这一轮标成
  // cancelled，要是旧请求其实还挂着（按钮登录在取选项时就失败了，还没中止它），用户之后选中通行密钥，
  // 登录成功的结果会被当成已取消丢掉。
  const armRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    async function arm() {
      // 等待期间可能已经卸载，或者换成了新的一轮（enabled 变了、开发模式的 StrictMode 重复执行）：不能再发起请求。
      // 同一时刻只能有一个 WebAuthn 请求，新的一发起就会中止旧的；已经取消的这一轮抢在后面发起，会把新一轮的中止掉。
      if (!(await conditionalMediationAvailable()) || cancelled) {
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
      // 用户取消、被按钮登录或注册中止时（errorMessage 返回 null）不提示；其余的和按钮登录一样提示。
      const message = errorMessage(res.error);
      if (message !== null) {
        onError(message);
      }
      const code = errorCodeOf(res.error);
      if (code !== undefined && REARM_CODES.has(code)) {
        void arm();
      }
    }
    armRef.current = () => {
      void arm();
    };
    void arm();
    return () => {
      cancelled = true;
      armRef.current = null;
    };
  }, [enabled, onSignedIn, onError]);

  // 卸载后或者 enabled 为 false 时 armRef 是 null，什么也不做。
  return useCallback(() => armRef.current?.(), []);
}

type PasskeySectionProps = {
  siteKey: string;
  /** 已登录（"重新登录"模式）：不显示"只用通行密钥注册"。 */
  signedIn: boolean;
  /** 页面上有带 webauthn 的 QQ 号输入框，可以挂起浏览器自动填充。 */
  autofill: boolean;
  onSignedIn(isNewUser: boolean): void;
};

function PasskeySection({ siteKey, signedIn, autofill, onSignedIn }: PasskeySectionProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // setError 是 useState 的 setter，引用不变：作为 onError 传进去不会让 effect 每次渲染都重新执行。
  const rearm = useConditionalPasskey({ enabled: autofill, onSignedIn, onError: setError });

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
    // 按钮登录一开始就中止了挂起的自动填充请求；没有成功结束（出错或用户取消）时让它恢复。
    rearm();
  }

  return (
    <section>
      <h2>{m.login_passkey_heading()}</h2>
      <button type="button" disabled={pending} onClick={signIn}>
        {m.login_passkey_sign_in()}
      </button>

      {signedIn ? null : (
        <PasskeySignUp
          siteKey={siteKey}
          pending={pending}
          setPending={setPending}
          setError={setError}
          onSignedIn={onSignedIn}
          rearm={rearm}
        />
      )}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

type PasskeySignUpProps = {
  siteKey: string;
  pending: boolean;
  setPending(pending: boolean): void;
  setError(message: string | null): void;
  onSignedIn(isNewUser: boolean): void;
  rearm(): void;
};

// 单独成一个组件，只在没登录时挂载：useTurnstile 只在挂载时渲染 widget，它要和放 widget 的容器一起出现。
function PasskeySignUp({ siteKey, pending, setPending, setError, onSignedIn, rearm }: PasskeySignUpProps) {
  const turnstile = useTurnstile(siteKey);
  const [nickname, setNickname] = useState("");

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
      // 创建凭据同样会中止挂起的自动填充请求；注册没有成功（出错或用户取消）时让它恢复。
      rearm();
      return;
    }
    onSignedIn(true);
  }

  return (
    <>
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
    </>
  );
}
