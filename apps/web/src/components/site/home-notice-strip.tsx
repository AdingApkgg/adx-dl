import { ChevronRightIcon, MegaphoneIcon } from "lucide-react";
import Link from "next/link";

import { NoticeNewBadge } from "@/components/site/notices-unread-dot";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { latestNotice, notices, resolveText, todayUtc, type Notice } from "@/lib/notices";
import { cn } from "@astrodx/ui/lib/utils";

/**
 * One line on the home page pointing at the newest active notice.
 *
 * Most visitors land on the home page or a chart page and never open the
 * header's menus, so this is where a notice is most likely to be seen. Server
 * rendered from build-time data; only the "new" tag is client-side, and it
 * sits inline so its arrival never shifts the layout.
 */
export function HomeNoticeStrip({
  locale,
  list = notices,
  className,
}: {
  locale: Locale;
  list?: Notice[];
  className?: string;
}) {
  const notice = latestNotice(list, todayUtc());
  if (!notice) return null;

  const copy = getDictionary(locale).notices;
  const title = resolveText(notice.title, locale).value;

  return (
    <Link
      href={`${buildLocalePath("/notices", locale)}#${notice.id}`}
      className={cn(
        // Hero tokens (home-page.module.css): the strip sits inside the hero,
        // whose surface follows its own palette rather than the page's.
        "group flex w-fit max-w-full items-center gap-2 rounded-full border border-(--hero-control-border) bg-(--hero-control-bg) py-1 pr-2 pl-1 text-sm text-(--hero-strong) transition-colors hover:bg-(--hero-control-hover)",
        className
      )}
    >
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
        <MegaphoneIcon aria-hidden="true" className="size-3.5" />
        {copy.stripLabel}
      </span>
      <NoticeNewBadge id={notice.id} label={copy.newBadge} />
      <span className="min-w-0 truncate">{title}</span>
      <time dateTime={notice.publishedAt} className="hidden shrink-0 text-xs text-(--hero-muted) sm:inline">
        {notice.publishedAt}
      </time>
      <ChevronRightIcon
        aria-hidden="true"
        className="size-4 shrink-0 text-(--hero-muted) transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
