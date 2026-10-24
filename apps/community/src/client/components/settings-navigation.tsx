import { NavigationIndicator } from "./motion-ui";
import { Link } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

export function SettingsNavigation({ view }: { view: "profile" | "account" }) {
  return <nav className="community-content-nav" aria-label={m.ui_account_navigation()}>{([["profile", "/settings/profile", m.settings_profile_title()], ["account", "/settings/account", m.settings_account_title()]] as const).map(([key, href, label]) => <Link key={key} to={localizeHref(href)} aria-current={view === key ? "page" : undefined} className="community-motion-nav">{view===key?<NavigationIndicator group="settings"/>:null}{label}</Link>)}</nav>;
}
