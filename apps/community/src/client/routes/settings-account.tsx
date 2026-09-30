import { dehydrate, HydrationBoundary, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";

import { m } from "@/paraglide/messages.js";
import { getLocale, localizeHref } from "@/paraglide/runtime.js";
import { expectOk } from "@/shared/api-client";
import { htmlLang } from "@/shared/i18n/locale";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { isReauthError, QqCodeForm } from "../components/qq-code-form";
import { accountErrorRedirect } from "../lib/account-errors";
import { authClient } from "../lib/auth-client";
import { errorMessage } from "../lib/auth-errors";
import { getBrowserApi, getRenderApi, jsonRequest } from "../lib/browser";
import { loginHref, requireUser } from "../lib/require-user";
import { useHydrated } from "../lib/use-hydrated";
import { loginsQuery, sessionsQuery } from "../queries/account";
import { loginOptionsQuery } from "../queries/login-options";
import type { Route } from "./+types/settings-account";

export async function loader({ context, url }: Route.LoaderArgs) {
  await requireUser(context, url);
  const queryClient = context.get(queryClientContext);
  const api = context.get(apiContext);
  await Promise.all([
    queryClient.query(loginsQuery(api)),
    queryClient.query(sessionsQuery(api)),
    queryClient.query(loginOptionsQuery(api)),
  ]);
  return { dehydratedState: dehydrate(queryClient) };
}

export function meta() {
  return [
    { title: `${m.settings_account_title()} - ${m.site_name()}` },
    { name: "robots", content: "noindex" },
  ];
}

export default function SettingsAccount({ loaderData }: Route.ComponentProps) {
  return (
    <HydrationBoundary state={loaderData.dehydratedState}>
      <SettingsContent />
    </HydrationBoundary>
  );
}

type Failure = { message: string; reauth: boolean };

// "重新登录"的链接、QQ 绑定的重新登录链接和未登录时的跳转，登录后都回到这个地址（当前页）。去掉 error：它是一次性的
// 提示（Google 绑定失败的原因），带回来的话旧的错误提示会一直显示。welcome 是 1b 给新用户的欢迎语参数（1c 起新用户
// 先去首次登录引导页），旧链接里可能还带着，一并去掉。
export function returnPath(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete("error");
  params.delete("welcome");
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

// 设备名来自 User-Agent，构造出来的可以有上千个字符：每个名字最多显示 64 个字符，超出的换成省略号。
// 按字符（码点）数截，边界上的表情符号不会被劈成半个。
const DEVICE_NAME_MAX = 64;

function clipDeviceName(name: string | null): string | null {
  const chars = name ? Array.from(name) : [];
  return chars.length > DEVICE_NAME_MAX ? `${chars.slice(0, DEVICE_NAME_MAX).join("")}…` : name;
}

function SettingsContent() {
  const api = getRenderApi();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [params] = useSearchParams();
  const hydrated = useHydrated();
  const { data: logins } = useQuery(loginsQuery(api));
  const { data: sessions } = useQuery(sessionsQuery(api));
  const { data: options } = useQuery(loginOptionsQuery(api));
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const here = returnPath(location.pathname, location.search);
  const callbackMessage = params.get("error") ? errorMessage(params.get("error")) : null;

  const locale = htmlLang(getLocale());
  const formatDate = (iso: string | null) =>
    hydrated && iso ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso)) : "";
  const placeName = (country: string | null) =>
    country
      ? hydrated
        ? (new Intl.DisplayNames([locale], { type: "region" }).of(country) ?? country)
        : ""
      : m.settings_device_unknown_place();

  // 所有按钮共用：出错时翻译成文案；未登录跳去登录页、账号正在注销跳去注销提示页（spec 第 11.4 节）；
  // 要求刚登录的给出"重新登录"链接。
  // 成功和出错都刷新列表：出错时那一行可能已经在别处被删掉了。
  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setFailure(null);
    setNotice(null);
    try {
      const outcome = await action();
      const error = outcome && typeof outcome === "object" && "error" in outcome ? outcome.error : null;
      if (error) {
        throw error;
      }
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (error) {
      const target = accountErrorRedirect(error, here);
      if (target) {
        window.location.assign(target);
        return;
      }
      // 比如在别处已经被踢掉的会话，再点"下线"会得到 404：不刷新的话那一行一直留着。
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      const message = errorMessage(error);
      if (message) {
        setFailure({ message, reauth: isReauthError(error) });
      }
    } finally {
      setPending(false);
    }
  }

  async function revokeOthers() {
    const res = await expectOk(await getBrowserApi().api.v1.me.sessions["revoke-others"].$post(undefined, jsonRequest));
    const body = await res.json();
    // 响应类型里还有 403 的 { error }：expectOk 已经把非 2xx 都抛掉了，这里只是让类型收窄到成功的那种。
    if ("revoked" in body) {
      setNotice(m.settings_revoked_others({ count: body.revoked }));
    }
  }

  // 退出登录失败（限流、5xx、断网）时留在本页并提示：会话和 Cookie 都还在，不能让用户以为已经退出、
  // 还把他送回首页（公用电脑上这是一个用户以为已经结束的活会话）。成功时页面马上离开，不用恢复 pending。
  async function signOut() {
    setPending(true);
    setFailure(null);
    setNotice(null);
    const { error } = await authClient.signOut();
    if (error) {
      setFailure({ message: errorMessage(error) ?? m.error_unknown(), reauth: false });
      setPending(false);
      return;
    }
    window.location.assign(localizeHref("/"));
  }

  if (!logins || !sessions || !options) {
    return null;
  }
  return (
    <main>
      <h1>{m.settings_account_title()}</h1>
      <p>
        <Link to={localizeHref("/settings/profile")}>{m.settings_profile_title()}</Link>
      </p>
      {callbackMessage ? <p role="alert">{callbackMessage}</p> : null}
      {failure ? (
        <p role="alert">
          {failure.message}{" "}
          {failure.reauth ? <a href={loginHref(here, { reauth: "1" })}>{m.settings_reauth()}</a> : null}
        </p>
      ) : null}
      {notice ? <p>{notice}</p> : null}

      <section>
        <h2>{m.settings_logins_heading()}</h2>
        <ul>
          {logins.accounts.map((item) => (
            <li key={item.id}>
              {item.provider === "google"
                ? item.email
                  ? m.settings_login_google({ email: item.email })
                  : "Google"
                : item.nickname
                  ? m.settings_login_qq({ nickname: item.nickname, number: item.maskedQq })
                  : m.settings_login_qq_number({ number: item.maskedQq })}{" "}
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => authClient.unlinkAccount({ accountId: item.id }))}
              >
                {m.settings_unlink()}
              </button>
            </li>
          ))}
          {logins.passkeys.map((item) => (
            <li key={item.id}>
              {item.name ?? m.settings_passkey_default_name()} · {m.settings_passkey_added({ date: formatDate(item.createdAt) })} ·{" "}
              {item.lastUsedAt
                ? m.settings_passkey_last_used({ date: formatDate(item.lastUsedAt) })
                : m.settings_passkey_never_used()}{" "}
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => authClient.passkey.deletePasskey({ id: item.id }))}
              >
                {m.settings_remove_passkey()}
              </button>
            </li>
          ))}
        </ul>
        <p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() =>
                authClient.linkSocial({
                  provider: "google",
                  callbackURL: localizeHref("/settings/account"),
                  errorCallbackURL: localizeHref("/settings/account"),
                })
              )
            }
          >
            {m.settings_link_google()}
          </button>{" "}
          {/* 不传 name：它会同时变成系统密码管理器里显示的账号名和存下来的标签。 */}
          <button type="button" disabled={pending} onClick={() => run(() => authClient.passkey.addPasskey())}>
            {m.settings_add_passkey()}
          </button>
        </p>
        <details>
          <summary>{m.settings_link_qq()}</summary>
          {options.qq.available ? (
            <QqCodeForm
              siteKey={options.turnstileSiteKey}
              intent="link"
              reauthHref={loginHref(here, { reauth: "1" })}
              onVerified={() => void queryClient.invalidateQueries({ queryKey: ["me"] })}
            />
          ) : (
            <p>{m.login_qq_unavailable()}</p>
          )}
        </details>
      </section>

      <section>
        <h2>{m.settings_devices_heading()}</h2>
        <ul>
          {sessions.sessions.map((item) => (
            <li key={item.id}>
              {[clipDeviceName(item.browser), clipDeviceName(item.os)].filter(Boolean).join(" · ") || m.settings_device_unknown()} ·{" "}
              {placeName(item.country)} · {m.settings_device_last_active({ date: formatDate(item.lastActiveAt) })}{" "}
              {item.current ? (
                <strong>{m.settings_device_current()}</strong>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(async () =>
                      expectOk(await getBrowserApi().api.v1.me.sessions[":id"].$delete({ param: { id: item.id } }, jsonRequest))
                    )
                  }
                >
                  {m.settings_revoke()}
                </button>
              )}
            </li>
          ))}
        </ul>
        <button type="button" disabled={pending} onClick={() => run(revokeOthers)}>
          {m.settings_revoke_others()}
        </button>
      </section>

      <p>
        <button type="button" disabled={pending} onClick={signOut}>
          {m.settings_sign_out()}
        </button>
      </p>
    </main>
  );
}
