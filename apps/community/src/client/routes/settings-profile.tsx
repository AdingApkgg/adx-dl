import { dehydrate, HydrationBoundary, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useLocation } from "react-router";

import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { okJson } from "@/shared/api-client";
import { parseBio } from "@/shared/bio";
import { parseNickname } from "@/shared/nickname";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { Avatar } from "../components/avatar";
import { ProfileFields } from "../components/profile-fields";
import { accountErrorRedirect } from "../lib/account-errors";
import { errorMessage } from "../lib/auth-errors";
import { getBrowserApi, getRenderApi } from "../lib/browser";
import { requireUser } from "../lib/require-user";
import { meQuery } from "../queries/me";
import { profileQuery } from "../queries/profile";
import type { Route } from "./+types/settings-profile";

export async function loader({ context, url }: Route.LoaderArgs) {
  await requireUser(context, url);
  const queryClient = context.get(queryClientContext);
  await queryClient.query(profileQuery(context.get(apiContext)));
  return { dehydratedState: dehydrate(queryClient) };
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
      <ProfileContent />
    </HydrationBoundary>
  );
}

function ProfileContent() {
  const api = getRenderApi();
  const { data: me } = useQuery(meQuery(api));
  const { data: profile } = useQuery(profileQuery(api));
  if (!me || !profile) {
    return null;
  }
  return (
    <main>
      <h1>{m.settings_profile_title()}</h1>
      <p>
        <Avatar id={me.id} name={profile.name} size={64} /> {m.user_page_id({ id: me.id })}
      </p>
      <ProfileForm initialName={profile.name} initialBio={profile.bio} />
      <p>
        <Link to={localizeHref(`/u/${me.id}`)}>{m.profile_view_page()}</Link> ·{" "}
        <Link to={localizeHref("/settings/account")}>{m.settings_account_title()}</Link>
      </p>
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
  const [saved, setSaved] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
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
      setSaved(true);
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

  return (
    <form onSubmit={save}>
      <ProfileFields
        name={name}
        bio={bio}
        onNameChange={(value) => {
          setName(value);
          setSaved(false);
        }}
        onBioChange={(value) => {
          setBio(value);
          setSaved(false);
        }}
      />
      {error ? <p role="alert">{error}</p> : null}
      {saved ? <p role="status">{m.profile_saved()}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? m.login_working() : m.profile_save()}
      </button>
    </form>
  );
}
