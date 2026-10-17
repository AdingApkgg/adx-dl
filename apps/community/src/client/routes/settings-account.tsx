import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@astrodx/ui/components/card";
import { Input } from "@astrodx/ui/components/input";
import { toast } from "@astrodx/ui/components/sonner";
import { dehydrate, HydrationBoundary, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";

import { m } from "@/paraglide/messages.js";
import { getLocale, localizeHref } from "@/paraglide/runtime.js";
import { expectOk, okJson } from "@/shared/api-client";
import { htmlLang } from "@/shared/i18n/locale";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { PageTitle, textLinkClass } from "../components/page-title";
import { isReauthError, QqCodeForm } from "../components/qq-code-form";
import { accountErrorRedirect } from "../lib/account-errors";
import { clearUploadRecords } from "../lib/file-upload";
import { authClient } from "../lib/auth-client";
import { errorMessage } from "../lib/auth-errors";
import { getBrowserApi, getRenderApi, jsonRequest } from "../lib/browser";
import { loginHref, requireUser } from "../lib/require-user";
import { useHydrated } from "../lib/use-hydrated";
import { loginsQuery, sessionsQuery } from "../queries/account";
import { loginOptionsQuery } from "../queries/login-options";
import { meQuery } from "../queries/me";
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

// 登录方式、登录设备的列表：一行一项，按钮靠右。
const listClass = "divide-y rounded-lg border";
const rowClass = "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2";

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
  const { data: me } = useQuery(meQuery(api));
  const { data: logins } = useQuery(loginsQuery(api));
  const { data: sessions } = useQuery(sessionsQuery(api));
  const { data: options } = useQuery(loginOptionsQuery(api));
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  // 申请注销成功后的清除时间：这时已经退出登录，整页换成结果提示。
  const [deletedAt, setDeletedAt] = useState<string | null>(null);
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
  // 成功和出错都刷新列表：出错时那一行可能已经在别处被删掉了。成功时用 toast 显示 success（spec 第 7.3 节），
  // 出错仍然显示在页面上。
  async function run(action: () => Promise<unknown>, success?: () => string) {
    setPending(true);
    setFailure(null);
    try {
      const outcome = await action();
      const error = outcome && typeof outcome === "object" && "error" in outcome ? outcome.error : null;
      if (error) {
        throw error;
      }
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      if (success) {
        toast.success(success());
      }
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
      toast.success(m.settings_revoked_others({ count: body.revoked }));
    }
  }

  // 退出登录失败（限流、5xx、断网）时留在本页并提示：会话和 Cookie 都还在，不能让用户以为已经退出、
  // 还把他送回首页（公用电脑上这是一个用户以为已经结束的活会话）。成功时页面马上离开，不用恢复 pending。
  async function signOut() {
    setPending(true);
    setFailure(null);
    const { error } = await authClient.signOut();
    if (error) {
      setFailure({ message: errorMessage(error) ?? m.error_unknown(), reauth: false });
      setPending(false);
      return;
    }
    if (me) clearUploadRecords(me.id);
    window.location.assign(localizeHref("/"));
  }

  if (deletedAt) {
    return <DeletionStarted purgeAt={deletedAt} />;
  }
  if (!me || !logins || !sessions || !options) {
    return null;
  }
  // 登录方式、登录设备、注销账号各一张卡片，注销那一张用警示色（spec 第 7.5 节）。
  return (
    <main className="space-y-6">
      <PageTitle>{m.settings_account_title()}</PageTitle>
      <p className="text-sm">
        <Link to={localizeHref("/settings/profile")} className={textLinkClass}>
          {m.settings_profile_title()}
        </Link>
      </p>
      {callbackMessage ? <Alert variant="destructive">{callbackMessage}</Alert> : null}
      {failure ? (
        <Alert variant="destructive">
          <p>
            {failure.message}{" "}
            {failure.reauth ? (
              <a href={loginHref(here, { reauth: "1" })} className={textLinkClass}>
                {m.settings_reauth()}
              </a>
            ) : null}
          </p>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2>{m.settings_logins_heading()}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className={listClass}>
            {logins.accounts.map((item) => (
              <li key={item.id} className={rowClass}>
                {item.provider === "google"
                  ? item.email
                    ? m.settings_login_google({ email: item.email })
                    : "Google"
                  : item.provider === "awmc"
                    ? "AWMC"
                    : item.nickname
                    ? m.settings_login_qq({ nickname: item.nickname, number: item.maskedQq })
                    : m.settings_login_qq_number({ number: item.maskedQq })}{" "}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => authClient.unlinkAccount({ accountId: item.id }), m.toast_unlinked)}
                >
                  {m.settings_unlink()}
                </Button>
              </li>
            ))}
            {logins.passkeys.map((item) => (
              <li key={item.id} className={rowClass}>
                {item.name ?? m.settings_passkey_default_name()} · {m.settings_passkey_added({ date: formatDate(item.createdAt) })} ·{" "}
                {item.lastUsedAt
                  ? m.settings_passkey_last_used({ date: formatDate(item.lastUsedAt) })
                  : m.settings_passkey_never_used()}{" "}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => authClient.passkey.deletePasskey({ id: item.id }), m.toast_passkey_removed)}
                >
                  {m.settings_remove_passkey()}
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
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
            </Button>
            {options.awmc?.available ? (
              <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => authClient.linkSocial({
                provider: "awmc", callbackURL: localizeHref("/settings/account"), errorCallbackURL: localizeHref("/settings/account"),
              }))}>{m.settings_link_awmc()}</Button>
            ) : null}
            {/* 不传 name：它会同时变成系统密码管理器里显示的账号名和存下来的标签。 */}
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => authClient.passkey.addPasskey(), m.toast_passkey_added)}
            >
              {m.settings_add_passkey()}
            </Button>
          </div>
          <details className="rounded-lg border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">{m.settings_link_qq()}</summary>
            <div className="pt-3">
              {options.qq.available ? (
                <QqCodeForm
                  siteKey={options.turnstileSiteKey}
                  intent="link"
                  reauthHref={loginHref(here, { reauth: "1" })}
                  onVerified={() => {
                    toast.success(m.toast_qq_linked());
                    void queryClient.invalidateQueries({ queryKey: ["me"] });
                  }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{m.login_qq_unavailable()}</p>
              )}
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2>{m.settings_devices_heading()}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className={listClass}>
            {sessions.sessions.map((item) => (
              <li key={item.id} className={rowClass}>
                {[clipDeviceName(item.browser), clipDeviceName(item.os)].filter(Boolean).join(" · ") || m.settings_device_unknown()} ·{" "}
                {placeName(item.country)} · {m.settings_device_last_active({ date: formatDate(item.lastActiveAt) })}{" "}
                {item.current ? (
                  <strong className="text-xs font-medium text-primary">{m.settings_device_current()}</strong>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(
                        async () =>
                          expectOk(await getBrowserApi().api.v1.me.sessions[":id"].$delete({ param: { id: item.id } }, jsonRequest)),
                        m.toast_session_revoked
                      )
                    }
                  >
                    {m.settings_revoke()}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
        <CardFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => run(revokeOthers)}>
            {m.settings_revoke_others()}
          </Button>
        </CardFooter>
      </Card>

      <div>
        <Button type="button" variant="outline" disabled={pending} onClick={signOut}>
          {m.settings_sign_out()}
        </Button>
      </div>

      <DeleteAccountSection userId={me.id} publicId={me.publicId} here={here} onDeleted={setDeletedAt} />
    </main>
  );
}

type DeleteAccountSectionProps = {
  userId: string;
  publicId?: string | null;
  /** 重新登录后回到的地址。 */
  here: string;
  onDeleted(purgeAt: string): void;
};

// 注销账号（spec 第 10.6 节）。"同时删除内容"默认不勾（spec 选的 B：默认匿名保留）；要照着输入自己的用户 id
// 才能点（用户决定），服务端同样校验。
export function DeleteAccountSection({ userId, publicId, here, onDeleted }: DeleteAccountSectionProps) {
  const queryClient = useQueryClient();
  const [deleteContent, setDeleteContent] = useState(false);
  const [confirmId, setConfirmId] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const displayId = publicId ?? userId;
  const confirmed = confirmId.trim() === displayId;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed) {
      setFailure({ message: m.error_deletion_confirm_mismatch(), reauth: false });
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      const result = await okJson(
        await getBrowserApi().api.v1.me.deletion.$post({ json: { deleteContent, confirmId: displayId } })
      );
      clearUploadRecords(userId);
      onDeleted(result.purgeAt);
      // 响应已经清掉了会话 Cookie：缓存里的当前用户也要忘掉。不然页头还显示头像菜单，之后在页面里跳转
      // （首页的 clientLoader、布局的 clientMiddleware 都读这份缓存）也仍当成已登录。
      queryClient.setQueryData(meQuery(getBrowserApi()).queryKey, null);
    } catch (error) {
      const target = accountErrorRedirect(error, here);
      if (target) {
        window.location.assign(target);
        return;
      }
      setFailure({ message: errorMessage(error) ?? m.error_unknown(), reauth: isReauthError(error) });
      setPending(false);
    }
  }

  // 警示色的卡片（spec 第 7.5 节）：边框和标题用 destructive，提交按钮是 destructive 样式。
  return (
    <Card className="ring-destructive/40">
      <CardHeader>
        <CardTitle asChild>
          <h2 className="text-destructive">{m.settings_delete_heading()}</h2>
        </CardTitle>
        <CardDescription className="space-y-2">
          <p>{m.settings_delete_explain()}</p>
          <p>{m.settings_delete_content_default()}</p>
        </CardDescription>
      </CardHeader>
      <form onSubmit={submit}>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm accent-destructive">
            <input
              type="checkbox"
              name="deleteContent"
              checked={deleteContent}
              onChange={(event) => setDeleteContent(event.target.checked)}
            />
            {m.settings_delete_content()}
          </label>
          <label className="grid gap-2 text-sm font-medium">
            {m.settings_delete_confirm({ id: displayId })}
            <Input
              name="confirmId"
              value={confirmId}
              onChange={(event) => setConfirmId(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {failure ? (
            <Alert variant="destructive">
              <p>
                {failure.message}{" "}
                {failure.reauth ? (
                  <a href={loginHref(here, { reauth: "1" })} className={textLinkClass}>
                    {m.settings_reauth()}
                  </a>
                ) : null}
              </p>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="mt-(--card-spacing)">
          <Button type="submit" variant="destructive" disabled={pending || !confirmed}>
            {pending ? m.login_working() : m.settings_delete_submit()}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

// 申请成功：这个浏览器已经退出登录（响应清掉了会话 Cookie）。空账号的清除时间就是申请的时刻，几分钟内由 worker 删掉；
// 有内容的账号冷静期到了才删。只在点了按钮之后渲染，日期按本地时区显示不会有 hydrate 前后不一致的问题。
export function DeletionStarted({ purgeAt }: { purgeAt: string }) {
  const at = new Date(purgeAt);
  const scheduled = at.getTime() - Date.now() > 60_000;
  const date = new Intl.DateTimeFormat(htmlLang(getLocale()), { dateStyle: "medium", timeStyle: "short" }).format(at);
  return (
    <main className="space-y-6">
      <PageTitle>{m.settings_delete_heading()}</PageTitle>
      <Card>
        <CardHeader>
          <CardTitle asChild>
            <p role="status">{m.settings_delete_done()}</p>
          </CardTitle>
          <CardDescription>
            {scheduled ? m.settings_delete_done_scheduled({ date }) : m.settings_delete_done_immediate()}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild>
            <a href={localizeHref("/")}>{m.settings_delete_home()}</a>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
