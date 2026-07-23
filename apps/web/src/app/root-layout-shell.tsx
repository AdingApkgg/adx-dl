import type { Viewport } from "next";
import Link from "next/link";

import { LocaleSuggestionBanner } from "@/app/locale-suggestion-banner";
import { PageTransition } from "@/app/page-transition";
import { MotionProvider } from "@/components/motion";
import { DownloadDock } from "@/components/site/downloads/download-dock";
import { MusicPlayer } from "@/components/site/music-player/music-player";
import { PageViewsProvider, SitePageViews } from "@/components/site/page-view-counter";
import { ServiceWorkerRegistrar } from "@/components/site/service-worker-registrar";
import { SiteHeader } from "@/components/site/site-header";
import { SiteUptime } from "@/components/site/site-uptime";
import { SWRProvider } from "@/components/site/swr-provider";
import { TapRipple } from "@/components/site/tap-ripple";
import { ThemeProvider } from "@/components/site/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { readCatalog, readVersionGroups } from "@/lib/catalog";
import { CHART_MEDIA_ORIGIN } from "@/lib/chart-media";
import { ASTRODX_SITE_URL, astroDxDownloadUrl, wikiUrl } from "@/lib/resource-links";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { musicTracksForVersion } from "@/lib/music-playlists";

type RootLayoutShellProps = Readonly<{
  children: React.ReactNode;
  lang: string;
  locale: Locale;
}>;

// An explicit light/dark mode wins; otherwise the color mode follows the OS.
// The inline colorScheme style tells the browser the right canvas color while
// the render-blocking stylesheet is still loading (the CSS `color-scheme`
// only kicks in afterwards) — without it a dark-mode reload flashes white.
// The music-player attribute mirrors music-player-preferences.ts.
const NO_FLASH_BOOT_SCRIPT = `(function(){var e=document.documentElement;try{var t=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var d=t==='light'?false:(t==='dark'?true:m);e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(x){e.classList.add('dark');e.style.colorScheme='dark';}try{var a=localStorage.getItem('astrodx-accent');var c=['blue','violet','teal','orange','rose'];e.dataset.accent=c.indexOf(a)>=0?a:'blue';}catch(x){e.dataset.accent='blue';}try{var p=localStorage.getItem('adx-reduce-motion');p=p==='1'?'off':(p==='0'?'system':p);p=p==='on'||p==='off'?p:'system';e.dataset.motion=p;e.toggleAttribute('data-reduced-motion',p==='off');}catch(x){e.dataset.motion='system';}try{var s=JSON.parse(localStorage.getItem('astrodx-music-player-prefs-v1')||'{}');e.dataset.musicPlayer=s.enabled===false?'off':(s.collapsed===false?'expanded':'collapsed');}catch(x){e.dataset.musicPlayer='collapsed';}})();`;

/**
 * Shared by both html-owning layouts. The color-scheme meta lands early in
 * <head>, so the browser paints the pre-CSS blank canvas in the OS color mode
 * instead of default white — the main source of the dark-mode reload flash.
 * theme-color matches --background (hex: theme-color meta parsing of oklch is
 * not universal) for browser UI surfaces around the page.
 */
export const rootViewport: Viewport = {
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b111f" },
    { media: "(prefers-color-scheme: light)", color: "#f8fcff" },
  ],
};

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

export async function RootLayoutShell({ children, lang, locale }: RootLayoutShellProps) {
  const catalog = await readCatalog();
  const musicVersions = (await readVersionGroups()).filter(
    (version) => version.imageIndex !== null && version.count > 0
  );
  const initialMusicVersionId = musicVersions[0]?.imageIndex ?? 0;
  // One immediately playable track keeps the global layout payload small.
  // The complete 27-version manifest is fetched only when playback or the
  // playlist panel is requested.
  const initialMusicTracks = musicTracksForVersion(
    catalog,
    initialMusicVersionId
  ).slice(0, 1);
  const dictionary = getDictionary(locale);
  const updatedDate = catalog.generated_at.slice(0, 10);

  return (
    <html lang={lang} className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground">
        {/* Runs synchronously during HTML parse — first in <body>, before any
            visible content — so the persisted color mode, accent, motion and
            music-player preferences apply without a flash. Must stay inside
            the <html> tree: React 19 rejects inline scripts in the fragment
            root, and next/script beforeInteractive triggers the same dev
            error there. On soft navigations React reuses (does not re-run)
            the hydrated tag, which is fine — the attributes are already set. */}
        <script
          id="theme-init"
          dangerouslySetInnerHTML={{ __html: NO_FLASH_BOOT_SCRIPT }}
        />
        {/* Resource hints — every cover image is served from this cross-origin
            host; preconnect already implies DNS resolution, so no dns-prefetch
            fallback for it. The dns-prefetch below are for hosts we only warm. */}
        <link rel="preconnect" href={CHART_MEDIA_ORIGIN} crossOrigin="" />
        <link rel="dns-prefetch" href={COUNTER_HOST} />
        <link rel="dns-prefetch" href={COMMENT_HOST} />
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
              <div className="site-shell-background flex min-h-screen flex-col">
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
                    <p className="text-xs text-muted-foreground">{dictionary.footer.lastUpdated(updatedDate)}</p>
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
              </div>
              {/* Lives above the page subtree so an in-flight download keeps
                  rendering progress after a client-side navigation. */}
              <DownloadDock locale={locale} />
              <MusicPlayer
                locale={locale}
                versions={musicVersions}
                initialVersionId={initialMusicVersionId}
                initialTracks={initialMusicTracks}
              />
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
