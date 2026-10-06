import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@astrodx/ui/components/card";
import { dehydrate, HydrationBoundary, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { redirect, useLocation } from "react-router";

import { m } from "@/paraglide/messages.js";
import { getLocale, localizeHref } from "@/paraglide/runtime.js";
import { okJson } from "@/shared/api-client";
import { htmlLang } from "@/shared/i18n/locale";
import { queryClientContext } from "@/shared/router-context";

import { accountErrorRedirect } from "../lib/account-errors";
import { authClient } from "../lib/auth-client";
import { errorMessage } from "../lib/auth-errors";
import { getBrowserApi, getRenderApi, jsonRequest } from "../lib/browser";
import { requireUser } from "../lib/require-user";
import { useHydrated } from "../lib/use-hydrated";
import { meQuery } from "../queries/me";
import type { Route } from "./+types/account-deletion";

const DAY_MS = 24 * 60 * 60 * 1000;

// 注销提示页（spec 第 10.6 节）：冷静期里的用户登录后只能看到这里，可以撤销注销或者退出。
export async function loader({ context, url }: Route.LoaderArgs) {
  const me = await requireUser(context, url);
  // 正常状态的用户没什么可看的，回首页。
  if (me.status !== "pending_deletion") {
    throw redirect(localizeHref("/"));
  }
  return { dehydratedState: dehydrate(context.get(queryClientContext)) };
}

export function meta() {
  return [{ title: `${m.account_deletion_title()} - ${m.site_name()}` }, { name: "robots", content: "noindex" }];
}

export default function AccountDeletion({ loaderData }: Route.ComponentProps) {
  return (
    <HydrationBoundary state={loaderData.dehydratedState}>
      <DeletionContent />
    </HydrationBoundary>
  );
}

function DeletionContent() {
  const { data: me } = useQuery(meQuery(getRenderApi()));
  const location = useLocation();
  // 剩下几天、还能不能撤销取决于现在的时间：等浏览器 hydrate 之后再算，服务端和浏览器渲染出的文字才一致。
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (!me?.deletionPurgeAt) {
    return null;
  }
  const purgeAt = new Date(me.deletionPurgeAt);
  const remainingMs = purgeAt.getTime() - Date.now();
  const due = hydrated && remainingMs <= 0;

  async function cancel() {
    setPending(true);
    setFailure(null);
    try {
      await okJson(await getBrowserApi().api.v1.me.deletion.$delete(undefined, jsonRequest));
      // 整页跳转：别的页面要按恢复后的状态重新渲染。
      window.location.assign(localizeHref("/"));
    } catch (error) {
      const target = accountErrorRedirect(error, `${location.pathname}${location.search}`);
      if (target) {
        window.location.assign(target);
        return;
      }
      setFailure(errorMessage(error) ?? m.error_unknown());
      setPending(false);
    }
  }

  // 失败时留在本页并提示：会话还在，不能让用户以为已经退出。
  async function signOut() {
    setPending(true);
    setFailure(null);
    const { error } = await authClient.signOut();
    if (error) {
      setFailure(errorMessage(error) ?? m.error_unknown());
      setPending(false);
      return;
    }
    window.location.assign(localizeHref("/"));
  }

  const date = new Intl.DateTimeFormat(htmlLang(getLocale()), { dateStyle: "medium", timeStyle: "short" }).format(purgeAt);
  // "撤销注销"是主按钮，"退出登录"是次要按钮（spec 第 7.5 节）。
  return (
    <main>
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle asChild>
            <h1 className="text-xl font-semibold">{m.account_deletion_title()}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {hydrated ? (
            due ? (
              <p>{m.account_deletion_due()}</p>
            ) : (
              <>
                <p>{m.account_deletion_scheduled({ date })}</p>
                <p className="font-medium">{m.account_deletion_days_left({ days: Math.ceil(remainingMs / DAY_MS) })}</p>
                <p className="text-muted-foreground">{m.account_deletion_cancel_hint()}</p>
              </>
            )
          ) : null}
          {failure ? <Alert variant="destructive">{failure}</Alert> : null}
        </CardContent>
        <CardFooter className="gap-2">
          <Button type="button" disabled={pending || due} onClick={cancel}>
            {m.account_deletion_cancel()}
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={signOut}>
            {m.settings_sign_out()}
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
