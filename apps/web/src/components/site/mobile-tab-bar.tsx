"use client";

import * as React from "react";
import { EllipsisIcon } from "lucide-react";
import Link from "next/link";

import { formatUnreadCount, useUnreadNoticeCount } from "@/components/site/notices-unread-dot";
import { DropdownMenu, DropdownMenuTrigger } from "@astrodx/ui/components/dropdown-menu";
import { cn } from "@astrodx/ui/lib/utils";

export type TabBarLink = {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  /** Shows the unread-notice count on this tab. */
  noticeCount?: boolean;
  /** Accessible name while notices are unread, e.g. "公告，2 条未读". */
  unreadLabel?: (count: number) => string;
};

const TAB_CLASS =
  "relative flex h-full min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-[11px] leading-tight font-medium text-muted-foreground transition-colors outline-none focus-visible:bg-muted aria-[current=page]:text-primary data-[state=open]:text-primary [&_svg]:size-5 [&_svg]:shrink-0";

/**
 * Elements that bring up the on-screen keyboard. Checkboxes, radios, buttons
 * and range sliders are inputs too, but focusing them doesn't.
 */
function opensKeyboard(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"].includes(
    target.type
  );
}

/**
 * Hides the bar while a text field has focus. With the keyboard up the bar
 * either rides on top of it (Android) or floats mid-screen (iOS) — both eat
 * the little room left around the field being typed into. The root attribute
 * hands the bottom edge back to the floating surfaces (globals.css).
 */
function useHiddenWhileTyping(): boolean {
  const [typing, setTyping] = React.useState(false);

  React.useEffect(() => {
    const sync = () => setTyping(opensKeyboard(document.activeElement));
    // focusout fires before the next element is focused; wait a tick so
    // moving between two fields doesn't flash the bar back in between.
    const onFocusOut = () => window.setTimeout(sync, 0);
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  React.useEffect(() => {
    const root = document.documentElement;
    if (typing) root.dataset.mobileTabbar = "hidden";
    else delete root.dataset.mobileTabbar;
    return () => {
      delete root.dataset.mobileTabbar;
    };
  }, [typing]);

  return typing;
}

/**
 * Phone-only bottom navigation: four destinations plus a "more" menu.
 *
 * Below sm the header shrinks to a single row (brand, language, settings) and
 * these move here, within thumb reach. The menu is the same one the header's
 * hamburger opens at sm–lg — `menu` is that dropdown's content, built by the
 * header so both stay one list.
 *
 * z-30: above the sticky header (z-20), below the floating music player and
 * download surfaces (z-40/50, which stack above it via --floating-bottom) and
 * below every dialog and the chart preview's fullscreen layer (z-60+), which
 * therefore cover it without any special-casing.
 */
export function MobileTabBar({
  label,
  links,
  menuLabel,
  menuActive,
  menu,
}: {
  label: string;
  links: TabBarLink[];
  menuLabel: string;
  menuActive: boolean;
  menu: React.ReactNode;
}) {
  const hidden = useHiddenWhileTyping();
  const unread = useUnreadNoticeCount();

  return (
    <nav
      aria-label={label}
      data-mobile-tabbar-root=""
      hidden={hidden}
      style={{ viewTransitionName: "mobile-tabbar" }}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      <ul className="grid h-(--mobile-tabbar-height) list-none grid-cols-5 p-0">
        {links.map((link) => {
          const count = link.noticeCount ? unread : 0;
          return (
            <li key={link.label} className="min-w-0">
              <Link
                href={link.href}
                onClick={link.onClick}
                aria-current={link.active ? "page" : undefined}
                aria-label={count > 0 && link.unreadLabel ? link.unreadLabel(count) : undefined}
                className={TAB_CLASS}
              >
                <span aria-hidden="true" className="relative">
                  {link.icon}
                  {count > 0 ? (
                    <span className="absolute -top-1.5 -right-2.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive-strong px-1 text-[10px] leading-none font-semibold text-white tabular-nums ring-2 ring-background dark:text-neutral-950">
                      {formatUnreadCount(count)}
                    </span>
                  ) : null}
                </span>
                <span className="max-w-full truncate">{link.label}</span>
              </Link>
            </li>
          );
        })}
        <li className="min-w-0">
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(TAB_CLASS, "w-full", menuActive && "text-primary")}
            >
              <EllipsisIcon aria-hidden="true" />
              <span className="max-w-full truncate">{menuLabel}</span>
            </DropdownMenuTrigger>
            {menu}
          </DropdownMenu>
        </li>
      </ul>
    </nav>
  );
}
