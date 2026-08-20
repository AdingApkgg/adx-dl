import type { Viewport } from "next";

import { LocaleSuggestionBanner } from "@/app/locale-suggestion-banner";
import { PageTransition } from "@/app/page-transition";
import { MotionProvider } from "@/components/motion";
import { ConnectionStatusBar } from "@/components/site/connection-status-bar";
import { DownloadDock } from "@/components/site/downloads/download-dock";
import { MusicPlayer } from "@/components/site/music-player/music-player";
import { PageViewsProvider } from "@/components/site/page-view-counter";
import { ServiceWorkerRegistrar } from "@/components/site/service-worker-registrar";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { SWRProvider } from "@/components/site/swr-provider";
import { TapRipple } from "@/components/site/tap-ripple";
import { ThemeProvider } from "@/components/site/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { readCatalog, readVersionGroups } from "@/lib/catalog";
import { CHART_MEDIA_ORIGIN } from "@/lib/chart-media";
import { getDictionary, type Locale } from "@/lib/i18n";
import { musicTracksForVersion } from "@/lib/music-playlists";

type RootLayoutShellProps = Readonly<{
  children: React.ReactNode;
  lang: string;
  locale: Locale;
  /**
   * Only the exported 404 page sets this. That one file answers every unmatched
   * URL across all three trees, so its chrome has to adopt the locale from the
   * address bar instead of the `zh` this shell was rendered with.
   */
  deriveLocaleFromPath?: boolean;
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

// Third-party services warmed early: the pageview counter (fetched on every
// page) and the comment backend (fetched on chart detail pages).
const COUNTER_HOST = "https://bsz.saop.cc";
const COMMENT_HOST = "https://artalk.saop.cc";

export async function RootLayoutShell({
  children,
  lang,
  locale,
  deriveLocaleFromPath = false,
}: RootLayoutShellProps) {
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
        {/* Reuse terms in the two places a scraper is most likely to look at
            the markup rather than the page text. A static export cannot send a
            `Link: rel=license` header, so this is the header's stand-in. */}
        <link
          rel="license"
          href="https://creativecommons.org/licenses/by/4.0/"
        />
        <meta
          name="copyright"
          content={`${dictionary.siteName} — https://adxdls.saop.cc`}
        />
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
                <ConnectionStatusBar locale={locale} />
                <SiteHeader totalEntries={catalog.total_entries} />
                <PageTransition>{children}</PageTransition>
                <SiteFooter locale={locale} updatedDate={updatedDate} deriveLocaleFromPath={deriveLocaleFromPath} />
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
