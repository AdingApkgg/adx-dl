"use client";

import { MegaphoneIcon } from "lucide-react";
import Link from "next/link";

import { HEADER_ACTION_CLASS } from "@/components/site/header-actions";
import {
  formatUnreadCount,
  useUnreadNoticeCount,
} from "@/components/site/notices-unread-dot";
import { Button } from "@astrodx/ui/components/button";
import { cn } from "@astrodx/ui/lib/utils";

/**
 * The header's direct way to /notices, visible at every width.
 *
 * It used to be one item deep in the "more" menu, signalled only by an 8px dot
 * on that menu's trigger — most visitors never learned the page existed. The
 * count sits in the corner rather than inline so the button's width never
 * changes when it appears or clears.
 */
export function NoticesHeaderButton({
  href,
  label,
  unreadLabel,
  active,
}: {
  href: string;
  label: string;
  unreadLabel: (count: number) => string;
  active: boolean;
}) {
  const count = useUnreadNoticeCount();
  const accessibleName = count > 0 ? unreadLabel(count) : label;

  return (
    <Button
      variant="outline"
      size="sm"
      asChild
      className={cn(
        HEADER_ACTION_CLASS,
        // Phones reach notices from the bottom tab bar.
        "relative max-sm:hidden",
        active && "bg-secondary text-secondary-foreground dark:bg-secondary"
      )}
    >
      <Link
        href={href}
        aria-label={accessibleName}
        title={accessibleName}
        aria-current={active ? "page" : undefined}
      >
        <MegaphoneIcon aria-hidden="true" />
        <span className="hidden xl:inline">{label}</span>
        {count > 0 ? (
          <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 flex">
            {/* One soft ring that pulses a few times, then stops: enough to
                catch the eye on arrival without nagging for the whole visit. */}
            <span className="absolute inset-0 rounded-full bg-destructive-strong opacity-60 motion-safe:animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_3]" />
            <span className="relative inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive-strong px-1 text-[10px] leading-none font-semibold text-white tabular-nums ring-2 ring-background dark:text-neutral-950">
              {formatUnreadCount(count)}
            </span>
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
