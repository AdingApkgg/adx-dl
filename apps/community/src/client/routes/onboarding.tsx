import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@astrodx/ui/components/card";
import { toast } from "@astrodx/ui/components/sonner";
import { dehydrate, HydrationBoundary, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { redirect, useLocation, useSearchParams } from "react-router";

import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { okJson } from "@/shared/api-client";
import { parseBio } from "@/shared/bio";
import { parseNickname } from "@/shared/nickname";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { PageTitle, textLinkClass } from "../components/page-title";
import { ProfileFields } from "../components/profile-fields";
import { isReauthError } from "../components/qq-code-form";
import { accountErrorRedirect } from "../lib/account-errors";
import { trackEvent } from "../lib/analytics";
import { authClient } from "../lib/auth-client";
import { errorMessage } from "../lib/auth-errors";
import { getBrowserApi, getRenderApi } from "../lib/browser";
import { safeNextPath } from "../lib/next-path";
import { loginHref, requireUser } from "../lib/require-user";
import { profileQuery } from "../queries/profile";
import type { Route } from "./+types/onboarding";

// 首次登录引导（spec 第 10.3 节，用户决定）：新用户登录后先到这里。点过"完成"或"以后再说"就记下来，
// 之后再打开这个地址直接去 next。
export async function loader({ context, url }: Route.LoaderArgs) {
  await requireUser(context, url);
  const queryClient = context.get(queryClientContext);
  const profile = await queryClient.query(profileQuery(context.get(apiContext)));
  if (profile.onboardedAt) {
    throw redirect(safeNextPath(url.searchParams.get("next"), localizeHref("/")));
  }
  return { dehydratedState: dehydrate(queryClient) };
}

export function meta() {
  return [{ title: `${m.onboarding_title()} - ${m.site_name()}` }, { name: "robots", content: "noindex" }];
}

export default function Onboarding({ loaderData }: Route.ComponentProps) {
  return (
    <HydrationBoundary state={loaderData.dehydratedState}>
      <OnboardingContent />
    </HydrationBoundary>
  );
}

type Failure = { message: string; reauthHref: string | null };

function OnboardingContent() {
  const { data: profile } = useQuery(profileQuery(getRenderApi()));
  const [params] = useSearchParams();
  const location = useLocation();
  const next = safeNextPath(params.get("next"), localizeHref("/"));
  const here = `${location.pathname}${location.search}`;
  const [name, setName] = useState(profile?.name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  function fail(error: unknown) {
    const target = accountErrorRedirect(error, here);
    if (target) {
      window.location.assign(target);
      return;
    }
    const message = errorMessage(error);
    if (message) {
      setFailure({ message, reauthHref: isReauthError(error) ? loginHref(here, { reauth: "1" }) : null });
    }
  }

  // "完成"和"以后再说"都记下"看过了"：前者顺便保存昵称和简介。成功后整页跳走，首页等页面要带着新昵称重新渲染。
  async function finish(update: { name?: string; bio?: string }) {
    setPending(true);
    setFailure(null);
    try {
      await okJson(await getBrowserApi().api.v1.me.profile.$patch({ json: { ...update, onboarded: true } }));
      // 统计（spec 第 11.6 节）。tracker 的上报用 keepalive，紧接着整页跳走也会发出去。
      trackEvent("onboarding_done");
      window.location.assign(next);
    } catch (error) {
      fail(error);
      setPending(false);
    }
  }

  function done(event: FormEvent) {
    event.preventDefault();
    const nickname = parseNickname(name);
    if (nickname === null) {
      setFailure({ message: m.error_nickname_invalid(), reauthHref: null });
      return;
    }
    const cleanBio = parseBio(bio);
    if (cleanBio === null) {
      setFailure({ message: m.error_bio_too_long(), reauthHref: null });
      return;
    }
    void finish({ name: nickname, bio: cleanBio });
  }

  // 添加通行密钥要求 10 分钟内刚登录过：新用户刚注册，一般都满足；隔久了会得到"重新登录"的提示。
  async function addPasskey() {
    setPending(true);
    setFailure(null);
    const res = await authClient.passkey.addPasskey();
    setPending(false);
    if (res?.error) {
      fail(res.error);
      return;
    }
    // 成功用 toast 提示，出错仍然显示在表单旁边（spec 第 7.3 节）。
    toast.success(m.toast_passkey_added());
  }

  if (!profile) {
    return null;
  }
  // 表单卡片（spec 第 7.5 节）：昵称和简介，再加一种登录方式，最后是"完成"和"以后再说"。
  return (
    <main className="space-y-6">
      <PageTitle description={m.onboarding_intro()}>{m.onboarding_title()}</PageTitle>
      <form onSubmit={done}>
        <Card>
          <CardContent>
            <ProfileFields name={name} bio={bio} onNameChange={setName} onBioChange={setBio} />
          </CardContent>
          <CardHeader className="border-t pt-(--card-spacing)">
            <CardTitle asChild>
              <h2>{m.onboarding_backup_heading()}</h2>
            </CardTitle>
            <CardDescription>{m.onboarding_backup_hint()}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button type="button" variant="outline" disabled={pending} onClick={addPasskey}>
              {m.onboarding_add_passkey()}
            </Button>
            <a href={localizeHref("/settings/account")} className={textLinkClass}>
              {m.onboarding_link_accounts()}
            </a>
          </CardContent>
          {failure ? (
            <CardContent>
              <Alert variant="destructive">
                <p>
                  {failure.message}{" "}
                  {failure.reauthHref ? (
                    <a href={failure.reauthHref} className={textLinkClass}>
                      {m.settings_reauth()}
                    </a>
                  ) : null}
                </p>
              </Alert>
            </CardContent>
          ) : null}
          <CardFooter className="gap-2">
            <Button type="submit" disabled={pending}>
              {m.onboarding_done()}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => void finish({})}>
              {m.onboarding_skip()}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </main>
  );
}
