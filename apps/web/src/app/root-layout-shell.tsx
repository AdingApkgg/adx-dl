import Link from "next/link";

import { LocaleSuggestionBanner } from "@/app/locale-suggestion-banner";
import { PageTransition } from "@/app/page-transition";
import { MotionProvider } from "@/components/motion";
import { DownloadDock } from "@/components/site/downloads/download-dock";
import { PageViewsProvider, SitePageViews } from "@/components/site/page-view-counter";
import { ServiceWorkerRegistrar } from "@/components/site/service-worker-registrar";
import { SiteHeader } from "@/components/site/site-header";
import { SWRProvider } from "@/components/site/swr-provider";
import { TapRipple } from "@/components/site/tap-ripple";
import { ThemeProvider } from "@/components/site/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { readCatalog } from "@/lib/catalog";
import { ASTRODX_APP_REPOSITORY } from "@/lib/friend-links";
import { ASTRODX_SITE_URL, wikiUrl } from "@/lib/resource-links";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";

type RootLayoutShellProps = Readonly<{
  children: React.ReactNode;
  lang: string;
  locale: Locale;
}>;

const COVER_HOST = "https://adxcs.saop.cc";
const SOURCE_REPOSITORY = "https://github.com/AdingApkgg/adx-dl";
// External monitor page; the in-site /status route was removed in favour of a
// direct link to the public dashboard.
const SERVER_STATUS_URL = "https://s.saop.cc/server/66";
// Third-party services warmed early: the pageview counter (fetched on every
// page) and the comment backend (fetched on chart detail pages).
const COUNTER_HOST = "https://bsz.saop.cc";
const COMMENT_HOST = "https://artalk.saop.cc";
const licenseLinkLabel: Record<Locale, string> = {
  zh: "许可与来源",
  en: "License & Sources",
  ja: "ライセンスと出典",
};

// Runs synchronously during HTML parse (before first paint) so the persisted
// theme is applied with no flash. Mirrors ThemeProvider's logic: an explicit
// 'light'/'dark' wins, otherwise (unset or 'system') follow the OS preference.
const noFlashThemeScript = `(function(){try{var t=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var d=t==='light'?false:(t==='dark'?true:m);document.documentElement.classList.toggle('dark',d);}catch(e){document.documentElement.classList.add('dark');}})();`;

// Speculation Rules: the static export ships full RSC payloads (the CF Pages
// prune was reverted — see repo history), so in-app links normally client-side
// navigate and animate via <PageTransition>. This rule covers the remaining
// cross-document loads (first visit, refresh, middle-click, expired cache):
// Chromium prefetches same-origin pages on hover/pointerdown so those hard
// navigations feel near-instant and the @view-transition in globals.css
// animates them. `prefetch` (not `prerender`) on purpose: it caches
// the HTML without running page scripts, so the pageview counter / comments
// backend are NOT triggered for merely-hovered pages. `href_matches: "/*"` only
// matches same-origin path-absolute URLs, so external links are excluded.
// Unsupported browsers (Firefox/Safari) ignore it — progressive enhancement.
const speculationRules = JSON.stringify({
  prefetch: [{ where: { href_matches: "/*" }, eagerness: "moderate" }],
});

export async function RootLayoutShell({ children, lang, locale }: RootLayoutShellProps) {
  const catalog = await readCatalog();
  const dictionary = getDictionary(locale);
  const updatedDate = catalog.generated_at.slice(0, 10);

  return (
    <html lang={lang} className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground">
        {/* Resource hints — every cover image is served from this cross-origin
            host; preconnect already implies DNS resolution, so no dns-prefetch
            fallback for it. The dns-prefetch below are for hosts we only warm. */}
        <link rel="preconnect" href={COVER_HOST} crossOrigin="" />
        <link rel="dns-prefetch" href={COUNTER_HOST} />
        <link rel="dns-prefetch" href={COMMENT_HOST} />
        <script dangerouslySetInnerHTML={{ __html: noFlashThemeScript }} />
        <script type="speculationrules" dangerouslySetInnerHTML={{ __html: speculationRules }} />
        <ServiceWorkerRegistrar />
        <a
          href="#main-content"
          className="sr-only rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
        >
          {dictionary.nav.skipToContent}
        </a>
        <ThemeProvider>
          <MotionProvider>
          <TooltipProvider>
            <SWRProvider>
            <PageViewsProvider>
              <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top,rgba(64,123,255,0.18),transparent_30%),linear-gradient(180deg,rgba(6,23,66,0.08),transparent_30%)]">
                {/* Only the zh (default) tree suggests switching: prefixed trees were an explicit choice. */}
                {locale === "zh" ? <LocaleSuggestionBanner /> : null}
                <SiteHeader totalEntries={catalog.total_entries} />
                <PageTransition>{children}</PageTransition>
                <footer className="mt-auto border-t border-border/60 bg-background/60">
                  <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-8 md:px-6">
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
                        {licenseLinkLabel[locale]}
                      </Link>
                      <a
                        className="text-muted-foreground hover:text-foreground"
                        href={ASTRODX_APP_REPOSITORY}
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
                    <p className="text-xs text-muted-foreground">{dictionary.footer.lastUpdated(updatedDate)}</p>
                    <SitePageViews
                      siteViewsLabel={dictionary.pageViews.siteViews}
                      siteVisitorsLabel={dictionary.pageViews.siteVisitors}
                    />
                    <p className="text-xs text-muted-foreground">{dictionary.footer.disclaimer}</p>
                  </div>
                </footer>
              </div>
              {/* Lives above the page subtree so an in-flight download keeps
                  rendering progress after a client-side navigation. */}
              <DownloadDock locale={locale} />
              {/* Global maimai-style tap feedback rings (decorative). */}
              <TapRipple />
            </PageViewsProvider>
            </SWRProvider>
          </TooltipProvider>
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
