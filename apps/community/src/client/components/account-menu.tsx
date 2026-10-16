import { Button } from "@astrodx/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@astrodx/ui/components/dropdown-menu";
import { toast } from "@astrodx/ui/components/sonner";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router";

import { m } from "@/paraglide/messages.js";
import { deLocalizeHref, localizeHref } from "@/paraglide/runtime.js";

import { clearUploadRecords } from "../lib/file-upload";
import { authClient } from "../lib/auth-client";
import { errorMessage } from "../lib/auth-errors";
import { getRenderApi } from "../lib/browser";
import { loginHref } from "../lib/require-user";
import { meQuery } from "../queries/me";
import { Avatar } from "./avatar";

// 页头的账号区（spec 第 7.2 节）：
// - 当前用户还没取到（服务端取的时候遇到 429、5xx）：留空，浏览器里取到之后再显示，已登录的人不会先看到"登录"；
// - 没登录：一个"登录"按钮，登录后回到当前页（已经在登录页上就不显示，/login/ 这样带斜杠的也算）；
// - 登录了：头像菜单。待注销的用户只能停在注销提示页，菜单里只有"退出登录"。
export function AccountMenu() {
  const { data: me } = useQuery(meQuery(getRenderApi()));
  const location = useLocation();

  if (me === undefined) {
    return null;
  }
  if (me === null) {
    if (deLocalizeHref(location.pathname).replace(/\/+$/, "") === "/login") {
      return null;
    }
    return (
      <Button asChild size="sm">
        <Link to={loginHref(`${location.pathname}${location.search}`)}>{m.nav_sign_in()}</Link>
      </Button>
    );
  }

  // 退出成功一律整页回首页：服务端渲染要按没登录的状态重新取数据。失败（限流、5xx、断网）时会话还在，
  // 留在本页并提示，不能让用户以为已经退出。
  async function signOut() {
    const { error } = await authClient.signOut();
    if (error) {
      toast.error(errorMessage(error) ?? m.error_unknown());
      return;
    }
    if (me) clearUploadRecords(me.id);
    window.location.assign(localizeHref("/"));
  }

  const pending = me.status === "pending_deletion";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={m.nav_account_menu({ name: me.name })}>
          <Avatar image={me.image} id={me.id} name={me.name} size={28} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent instant className="min-w-44">
        <DropdownMenuLabel className="truncate">{me.name}</DropdownMenuLabel>
        {pending ? null : (
          <>
            <DropdownMenuItem asChild>
              <Link to={localizeHref("/me/charts")}>{m.charts_title()}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to={localizeHref(`/u/${me.publicId ?? me.id}`)}>{m.nav_my_page()}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to={localizeHref("/settings/profile")}>{m.nav_profile()}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to={localizeHref("/settings/account")}>{m.nav_account()}</Link>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>{m.nav_sign_out()}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
