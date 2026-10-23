import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@astrodx/ui/components/card";
import { toast } from "@astrodx/ui/components/sonner";
import { dehydrate, HydrationBoundary, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useLocation } from "react-router";

import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { okJson } from "@/shared/api-client";
import { parseBio } from "@/shared/bio";
import { parseNickname } from "@/shared/nickname";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { AvatarUpload } from "../components/avatar-upload";
import { Avatar } from "../components/avatar";
import { PageTitle } from "../components/page-title";
import { SettingsNavigation } from "../components/settings-navigation";
import { ProfileFields } from "../components/profile-fields";
import { accountErrorRedirect } from "../lib/account-errors";
import { errorMessage } from "../lib/auth-errors";
import { getBrowserApi, getRenderApi } from "../lib/browser";
import { requireUser } from "../lib/require-user";
import { meQuery } from "../queries/me";
import { profileQuery } from "../queries/profile";
import type { Route } from "./+types/settings-profile";

export async function loader({ context, url }: Route.LoaderArgs) {
  const user = await requireUser(context, url);
  const queryClient = context.get(queryClientContext);
  await queryClient.query(profileQuery(context.get(apiContext), user.id));
  return { userId: user.id, dehydratedState: dehydrate(queryClient) };
}

export function meta() {
  return [
    { title: `${m.settings_profile_title()} - ${m.site_name()}` },
    { name: "robots", content: "noindex" },
  ];
}

export default function SettingsProfile({ loaderData }: Route.ComponentProps) {
  return (
    <HydrationBoundary state={loaderData.dehydratedState}>
      <ProfileContent key={loaderData.userId} userId={loaderData.userId} />
    </HydrationBoundary>
  );
}

function ProfileContent({ userId }: { userId: string }) {
  const api = getRenderApi();
  const { data: me } = useQuery(meQuery(api));
  const { data: profile } = useQuery({ ...profileQuery(api, userId), enabled: me?.id === userId && me.status === "active" });
  if (!me || me.id !== userId || me.status !== "active" || !profile) {
    return null;
  }
  return (
    <main className="community-settings-page space-y-6">
      <div className="community-page-heading"><PageTitle description={m.ui_account_profile_hint()}>{m.settings_profile_title()}</PageTitle><Button asChild variant="outline" className="min-h-11"><Link to={localizeHref(`/u/${me.publicId ?? me.id}`)}>{m.profile_view_page()}</Link></Button></div>
      <SettingsNavigation view="profile" />
      <div className="community-panel flex min-w-0 items-center gap-4"><Avatar image={profile.image} id={me.id} name={profile.name} size={64} /><div className="min-w-0 space-y-1"><p className="break-words font-semibold">{profile.name}</p><p className="text-sm text-muted-foreground">{m.user_page_id({ id: me.publicId ?? me.id })}</p></div></div>
      <section id="settings-avatar" aria-labelledby="settings-avatar-title" className="space-y-3"><h2 id="settings-avatar-title" className="community-section-title">{m.ui_account_avatar()}</h2><AvatarUpload userId={me.id} image={profile.image} revision={profile.avatarRevision} /></section>
      <ProfileForm key={me.id} initialName={profile.name} initialBio={profile.bio} />
    </main>
  );
}

function ProfileForm({ initialName, initialBio }: { initialName: string; initialBio: string }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [name, setName] = useState(initialName);
  const [bio, setBio] = useState(initialBio);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    // 和服务端同一套规则，先在这里挡一次，不用等请求回来。
    const nickname = parseNickname(name);
    if (nickname === null) {
      setError(m.error_nickname_invalid());
      return;
    }
    const cleanBio = parseBio(bio);
    if (cleanBio === null) {
      setError(m.error_bio_too_long());
      return;
    }
    setPending(true);
    setError(null);
    try {
      const updated = await okJson(await getBrowserApi().api.v1.me.profile.$patch({ json: { name: nickname, bio: cleanBio } }));
      setName(updated.name);
      setBio(updated.bio);
      // 昵称也显示在首页、个人主页上：["me"] 下的查询都刷新。
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      // 成功用 toast 提示，出错仍然显示在表单旁边（spec 第 7.3 节）。
      toast.success(m.profile_saved());
    } catch (failure) {
      const target = accountErrorRedirect(failure, `${location.pathname}${location.search}`);
      if (target) {
        window.location.assign(target);
        return;
      }
      setError(errorMessage(failure) ?? m.error_unknown());
    } finally {
      setPending(false);
    }
  }

  // 表单卡片（spec 第 7.5 节）。
  return (
    <form onSubmit={save} aria-labelledby="settings-details-title">
      <Card><CardHeader><CardTitle asChild><h2 id="settings-details-title">{m.ui_account_details()}</h2></CardTitle><CardDescription>{m.ui_account_details_hint()}</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <ProfileFields name={name} bio={bio} onNameChange={setName} onBioChange={setBio} />
          {error ? <Alert variant="destructive">{error}</Alert> : null}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? m.login_working() : m.profile_save()}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
