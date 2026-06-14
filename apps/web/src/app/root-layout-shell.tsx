import Link from "next/link";

import { SiteHeader } from "@/components/site/site-header";
import { ThemeProvider } from "@/components/site/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { readCatalog } from "@/lib/catalog";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";

type RootLayoutShellProps = Readonly<{
  children: React.ReactNode;
  lang: string;
  locale: Locale;
}>;

const COVER_HOST = "https://adx-dl.larx.cc";
const SOURCE_REPOSITORY = "https://github.com/AdingApkgg/adx-dl";

// Runs synchronously during HTML parse (before first paint) so the persisted
// theme is applied with no flash. Mirrors ThemeProvider's logic (default: dark).
const noFlashThemeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='light'?false:(t==='system'?window.matchMedia('(prefers-color-scheme: dark)').matches:true);document.documentElement.classList.toggle('dark',d);}catch(e){document.documentElement.classList.add('dark');}})();`;

export async function RootLayoutShell({ children, lang, locale }: RootLayoutShellProps) {
  const catalog = await readCatalog();
  const dictionary = getDictionary(locale);
  const updatedDate = catalog.generated_at.slice(0, 10);

  return (
    <html lang={lang} className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground">
        {/* Resource hints — every cover image is served from this cross-origin host. */}
        <link rel="preconnect" href={COVER_HOST} crossOrigin="" />
        <link rel="dns-prefetch" href={COVER_HOST} />
        <script dangerouslySetInnerHTML={{ __html: noFlashThemeScript }} />
        <a
          href="#main-content"
          className="sr-only rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
        >
          {dictionary.nav.skipToContent}
        </a>
        <ThemeProvider>
          <TooltipProvider>
            <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top,rgba(64,123,255,0.18),transparent_30%),linear-gradient(180deg,rgba(6,23,66,0.08),transparent_30%)]">
              <SiteHeader totalEntries={catalog.total_entries} />
              {children}
              <footer className="mt-auto border-t border-border/60 bg-background/60">
                <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-8 md:px-6">
                  <p className="max-w-2xl text-sm text-muted-foreground">
                    {dictionary.footer.description}
                  </p>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                    <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/", locale)}>
                      {dictionary.nav.home}
                    </Link>
                    <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/charts", locale)}>
                      {dictionary.nav.browse}
                    </Link>
                    <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/versions", locale)}>
                      {dictionary.versions.navLabel}
                    </Link>
                    <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/search", locale)}>
                      {dictionary.nav.search}
                    </Link>
                    <Link className="text-muted-foreground hover:text-foreground" href={buildLocalePath("/status", locale)}>
                      {dictionary.statusPage.title}
                    </Link>
                    <a
                      className="text-muted-foreground hover:text-foreground"
                      href={SOURCE_REPOSITORY}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {dictionary.footer.sourceLabel}
                    </a>
                  </div>
                  <p className="text-xs text-muted-foreground">{dictionary.footer.lastUpdated(updatedDate)}</p>
                  <p className="text-xs text-muted-foreground">{dictionary.footer.disclaimer}</p>
                </div>
              </footer>
            </div>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
