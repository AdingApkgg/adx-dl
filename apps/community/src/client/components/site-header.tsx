import {NotificationIndicator} from "./notification-indicator";
import { Link } from "react-router";

import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

import { AccountMenu } from "./account-menu";
import { LanguageMenu } from "./language-menu";
import { SettingsSheet } from "./settings-sheet";

// 页头（spec 第 7.2 节）：左边站名，回当前语言的首页；右边是语言切换、设置和账号区。
export function SiteHeader() {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-1 px-4">
        <Link to={localizeHref("/")} className="mr-auto truncate font-semibold tracking-tight">
          {m.site_name()}
        </Link>

        <LanguageMenu />
        <SettingsSheet />
        <AccountMenu />
      </div>
      <nav aria-label={m.site_navigation()} className="mx-auto flex max-w-3xl items-center gap-4 overflow-x-auto px-4 pb-2 text-sm">
       <Link className="inline-flex min-h-11 shrink-0 items-center underline-offset-4 hover:underline" to={localizeHref("/charts")}>{m.public_charts_title()}</Link>
       <Link className="inline-flex min-h-11 shrink-0 items-center underline-offset-4 hover:underline" to={localizeHref("/forum")}>{m.site_forum()}</Link>
       <Link className="inline-flex min-h-11 shrink-0 items-center underline-offset-4 hover:underline" to={localizeHref("/help")}>{m.site_help()}</Link>
       <Link className="inline-flex min-h-11 shrink-0 items-center underline-offset-4 hover:underline" to={localizeHref("/notices")}>{m.site_notices()}</Link>
       <Link className="inline-flex min-h-11 shrink-0 items-center underline-offset-4 hover:underline" to={localizeHref("/lists")}>{m.library_public_title()}</Link>
       <Link className="inline-flex min-h-11 shrink-0 items-center underline-offset-4 hover:underline" to={localizeHref("/downloads")}>{m.download_title()}</Link>
       <NotificationIndicator/>
      </nav>
    </header>
  );
}
