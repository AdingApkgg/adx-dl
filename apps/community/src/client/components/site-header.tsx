import { BrandMark } from "@astrodx/ui/components/brand-mark";
import { CompassIcon, FileMusicIcon, HeartHandshakeIcon, LibraryIcon, MegaphoneIcon, MenuIcon, MessageSquareIcon, SearchIcon, UploadIcon, ArrowUpRightIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router";
import { Button } from "@astrodx/ui/components/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@astrodx/ui/components/sheet";
import { m } from "@/paraglide/messages.js";
import { deLocalizeHref, getLocale, localizeHref } from "@/paraglide/runtime.js";
import { primarySection } from "../lib/site-navigation";
import { getRenderApi } from "../lib/browser";
import { meQuery } from "../queries/me";
import { AccountMenu } from "./account-menu";
import { LanguageMenu, LanguageOptions } from "./language-menu";
import { SettingsSheet } from "./settings-sheet";
import { NotificationIndicator } from "./notification-indicator";
import { NavigationIndicator } from "./motion-ui";
import { SecondaryNavigation } from "./secondary-navigation";
import { WorkspaceLinks } from "./workspace-navigation";

function primaryItems() {
  return [
    { key: "discover", href: "/", label: m.ui_nav_discover(), icon: CompassIcon },
    { key: "charts", href: "/charts", label: m.ui_nav_charts(), icon: FileMusicIcon },
    { key: "lists", href: "/lists", label: m.ui_nav_lists(), icon: LibraryIcon },
    { key: "forum", href: "/forum", label: m.site_forum(), icon: MessageSquareIcon },
  ] as const;
}

function PrimaryNavigation({ drawer = false }: { drawer?: boolean }) {
  const active = primarySection(deLocalizeHref(useLocation().pathname));
  return <nav aria-label={m.site_navigation()} className="community-primary-navigation">
    {primaryItems().map(({ key, href, label, icon: Icon }) => {
      const link = <Link key={key} to={localizeHref(href)} aria-current={active === key ? "page" : undefined} className={`community-primary-link community-motion-nav ${active === key ? "is-active" : ""}`}>
        {active === key ? <NavigationIndicator group={drawer ? "drawer" : "primary"} /> : null}
        <Icon aria-hidden="true" />{label}
      </Link>;
      return drawer ? <SheetClose key={key} asChild>{link}</SheetClose> : link;
    })}
  </nav>;
}

function MoreNavigation({ workspace, libraryHref }: { workspace: boolean; libraryHref: string }) {
  return <Sheet>
    <SheetTrigger asChild><button type="button" className="community-bottom-link community-motion-nav" aria-label={m.ui_more()} title={m.ui_more()}><MenuIcon aria-hidden="true" /><span>{m.ui_tab_more()}</span></button></SheetTrigger>
    <SheetContent closeLabel={m.ui_navigation_close()} className="community-navigation-drawer">
      <SheetHeader className="shrink-0 border-b px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] pr-14">
        <SheetTitle>{m.site_name()}</SheetTitle><SheetDescription>{m.ui_menu_hint()}</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <PrimaryNavigation drawer />
        <SecondaryNavigation closeOnSelect workspace={workspace} />
        {workspace ? <WorkspaceLinks closeOnSelect /> : <SheetClose asChild><Link className="community-side-link" to={localizeHref(libraryHref)}><LibraryIcon aria-hidden="true" />{m.ui_nav_mine()}</Link></SheetClose>}
        <div className="space-y-4 border-t px-2 pt-4"><LanguageOptions /><div className="flex flex-wrap items-center gap-2"><SettingsSheet /><a className="community-side-link" href="https://adxdls.saop.cc">{m.ui_web_site()}<ArrowUpRightIcon aria-hidden="true" className="size-4" /></a></div></div>
      </div>
    </SheetContent>
  </Sheet>;
}

export function SiteHeader() {
  const { data: me } = useQuery(meQuery(getRenderApi()));
  const workspace = me?.status === "active";
  const { pathname } = useLocation();
  const locale = getLocale();
  const donationPath = locale === "zh" ? "/donate" : `/${locale}/donate`;
  const sidebar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const nav = sidebar.current;
    if (!nav || !window.matchMedia("(min-width: 64rem)").matches) return;
    const selected = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (!selected) return;
    const item = selected.getBoundingClientRect(), viewport = nav.getBoundingClientRect();
    // Scroll only the navigation region; page position and focus stay intact.
    if (item.top < viewport.top) nav.scrollTop += item.top - viewport.top;
    else if (item.bottom > viewport.bottom) nav.scrollTop += item.bottom - viewport.bottom;
  }, [pathname, workspace]);
  return <header className="community-header">
    <a id="community-skip-link" href="#main-content" className="community-skip-link">{m.ui_skip_content()}</a>
    <div className="community-header-inner">
      <Link to={localizeHref("/")} className="community-brand" aria-label={m.site_name()}><span className="community-brand-mark"><BrandMark /></span><span><span className="block text-sm font-bold tracking-tight">INOTE</span><span className="block text-[11px] font-medium text-muted-foreground">{m.ui_brand_subtitle()}</span></span></Link>
      <div ref={sidebar} className="community-site-navigation hidden lg:block" data-community-navigation="sidebar">
        <PrimaryNavigation />
        <SecondaryNavigation workspace={workspace} />
        {workspace ? <WorkspaceLinks /> : null}
      </div>
      <div className="community-header-actions ml-auto flex shrink-0 items-center gap-0.5">
        {workspace ? <Button asChild size="sm" className="community-navigation-upload mr-1 hidden lg:inline-flex"><Link to={localizeHref("/me/charts/new")}><UploadIcon aria-hidden="true" />{m.chart_new()}</Link></Button> : null}
        <Button asChild variant="outline" size="icon" className="community-donation"><a href={`https://adxdls.saop.cc${donationPath}`} aria-label={m.ui_support_site()} title={m.ui_support_site()}><HeartHandshakeIcon aria-hidden="true" className="text-pink-600 dark:text-pink-400" /></a></Button>
        <Button asChild variant="ghost" size="icon"><Link to={localizeHref("/search")} aria-label={m.discovery_search_label()} title={m.discovery_search_label()}><SearchIcon aria-hidden="true" /></Link></Button>
        <NotificationIndicator compact />
        <div className="community-desktop-controls hidden items-center sm:flex"><LanguageMenu /><SettingsSheet /></div>
        <AccountMenu />
      </div>
    </div>
  </header>;
}

export function MobileNavigation() {
  const path = deLocalizeHref(useLocation().pathname);
  const active = primarySection(path);
  const { data: me } = useQuery(meQuery(getRenderApi()));
  const items = [
    { key: "home", href: "/", label: m.ui_tab_home(), icon: CompassIcon, active: active === "discover" },
    { key: "notices", href: "/notices", label: m.ui_tab_notices(), icon: MegaphoneIcon, active: path.replace(/\/$/, "") === "/notices" },
    { key: "charts", href: "/charts", label: m.ui_tab_search(), icon: SearchIcon, active: active === "charts" },
    { key: "forum", href: "/forum", label: m.ui_tab_community(), icon: MessageSquareIcon, active: active === "forum" },
  ];
  return (
    <nav aria-label={m.ui_mobile_navigation()} className="community-bottom-nav lg:hidden">
      {items.map(({ key, href, label, icon: Icon, active }) => (
        <Link key={key} to={localizeHref(href)} aria-current={active ? "page" : undefined} className="community-bottom-link community-motion-nav">
          {active ? <NavigationIndicator group="mobile" /> : null}
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </Link>
      ))}
      <MoreNavigation workspace={me?.status === "active"} libraryHref={me?.status === "pending_deletion" ? "/account-deletion" : "/me/library"} />
    </nav>
  );
}
