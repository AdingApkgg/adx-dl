"use client";

import Link from "next/link";

import { usePathLocale } from "@/app/use-path-locale";
import { SitePageViews } from "@/components/site/page-view-counter";
import { SiteUptime } from "@/components/site/site-uptime";
import { SITE_REPOSITORY as SOURCE_REPOSITORY } from "@/lib/community-links";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { ASTRODX_SITE_URL, astroDxDownloadUrl, wikiUrl } from "@/lib/resource-links";

// External monitor page; the in-site /status route was removed in favour of a
// direct link to the public dashboard.
const SERVER_STATUS_URL = "https://s.saop.cc/server/66";

type SiteFooterProps = {
  locale: Locale;
  /** Catalog build date, rendered as the "last updated" line. */
  updatedDate: string;
  /**
   * Re-derive the locale from the URL after mount. Only the 404 route needs
   * this: it is a single exported page served for every unmatched URL, so an
   * English visitor was reading an English heading above fifteen Chinese nav
   * links that all pointed back into the Chinese tree.
   */
  deriveLocaleFromPath?: boolean;
};

export function SiteFooter({
  locale: initialLocale,
  updatedDate,
  deriveLocaleFromPath = false,
}: SiteFooterProps) {
  const locale = usePathLocale(initialLocale, deriveLocaleFromPath);
  const dictionary = getDictionary(locale);

  return (
    <footer className="mt-auto border-t border-border/60 bg-background/60">
      {/* The expanded music player is fixed to the bottom on small screens, so
          the last few footer rows sat underneath it. Same reserve the download
          dock already honours. */}
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 pt-8 pb-[calc(2rem+var(--music-player-mobile-reserve,0rem))] md:px-6">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {dictionary.footer.description}
        </p>
        <nav
          aria-label={dictionary.footer.navLabel}
          className="flex flex-wrap gap-x-5 gap-y-2 text-sm"
        >
          <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/", locale)}>
            {dictionary.nav.home}
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/charts", locale)}>
            {dictionary.nav.browse}
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/versions", locale)}>
            {dictionary.versions.navLabel}
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/changelog", locale)}>
            {dictionary.changelog.navLabel}
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/music", locale)}>
            {dictionary.music.navLabel}
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/guide", locale)}>
            {dictionary.guide.navLabel}
          </Link>
          <a
            className="text-muted-foreground hover:text-foreground"
            href={ASTRODX_SITE_URL}
            target="_blank"
            rel="noreferrer"
          >
            {dictionary.resources.official}
          </a>
          <a
            className="text-muted-foreground hover:text-foreground"
            href={wikiUrl(locale)}
            target="_blank"
            rel="noreferrer"
          >
            {dictionary.resources.wiki}
          </a>
          <a
            className="text-muted-foreground hover:text-foreground"
            href={SERVER_STATUS_URL}
            target="_blank"
            rel="noreferrer"
          >
            {dictionary.statusPage.title}
          </a>
          <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/community", locale)}>
            {dictionary.community.navLabel}
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/comments", locale)}>
            {dictionary.guestbook.navLabel}
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/post", locale)}>
            {dictionary.post.navLabel}
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/survey", locale)}>
            {dictionary.survey.navLabel}
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/links", locale)}>
            {dictionary.links.navLabel}
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/donate", locale)}>
            {dictionary.donate.navLabel}
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/about", locale)}>
            {dictionary.about.navLabel}
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/license", locale)}>
            {dictionary.license.navLabel}
          </Link>
          <a
            className="text-muted-foreground hover:text-foreground"
            href={astroDxDownloadUrl(locale)}
            target="_blank"
            rel="noreferrer"
          >
            {dictionary.footer.getAppLabel}
          </a>
          <a
            className="text-muted-foreground hover:text-foreground"
            href={SOURCE_REPOSITORY}
            target="_blank"
            rel="noreferrer"
          >
            {dictionary.footer.sourceLabel}
          </a>
        </nav>
        <p className="text-xs text-muted-foreground">
          {dictionary.footer.lastUpdated(updatedDate)}
        </p>
        <SiteUptime locale={locale} />
        <SitePageViews
          siteViewsLabel={dictionary.pageViews.siteViews}
          siteVisitorsLabel={dictionary.pageViews.siteVisitors}
        />
        <p className="text-xs text-muted-foreground">{dictionary.footer.disclaimer}</p>
        <p className="text-xs text-muted-foreground">{dictionary.footer.aiNotice}</p>
        <p className="text-xs text-muted-foreground">
          {dictionary.footer.mitLicense.before}
          <a
            className="underline underline-offset-2 hover:text-foreground"
            href={`${SOURCE_REPOSITORY}/blob/main/LICENSE`}
            target="_blank"
            rel="noreferrer"
          >
            {dictionary.footer.mitLicense.link}
          </a>
          {dictionary.footer.mitLicense.after}
        </p>
      </div>
    </footer>
  );
}
