import { BookOpenIcon, CompassIcon, DownloadIcon, MegaphoneIcon, ShieldCheckIcon, TagsIcon, UsersIcon } from "lucide-react";
import { NavLink } from "react-router";
import { SheetClose } from "@astrodx/ui/components/sheet";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

// 桌面左栏和手机导航抽屉共用入口，避免两种布局的页面列表分叉。
export function SecondaryNavigation({ closeOnSelect = false, workspace = false }: { closeOnSelect?: boolean; workspace?: boolean }) {
  const groups = [
    { label: m.ui_group_explore(), items: [
      { href: "/discover", label: m.discovery_title(), icon: CompassIcon },
      { href: "/authors", label: m.discovery_authors(), icon: UsersIcon },
      { href: "/tags", label: m.discovery_tags(), icon: TagsIcon },
    ] },
    { label: m.ui_group_site(), items: [
      { href: "/notices", label: m.site_notices(), icon: MegaphoneIcon },
      { href: "/help", label: m.site_help(), icon: BookOpenIcon },
      ...(!workspace ? [{ href: "/downloads", label: m.download_title(), icon: DownloadIcon }] : []),
      { href: "/privacy", label: m.privacy_link(), icon: ShieldCheckIcon },
    ] },
  ];
  return <>{groups.map(group => <nav key={group.label} aria-label={group.label} className="community-nav-group">
    <p className="community-nav-label">{group.label}</p>
    {group.items.map(({ href, label, icon: Icon }) => {
      const link = <NavLink key={href} to={localizeHref(href)} className="community-side-link"><Icon aria-hidden="true" />{label}</NavLink>;
      return closeOnSelect ? <SheetClose key={href} asChild>{link}</SheetClose> : link;
    })}
  </nav>)}</>;
}
