import { SiteHeader } from "@/components/site/site-header";
import { ThemeProvider } from "@/components/site/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { readCatalog } from "@/lib/catalog";

type RootLayoutShellProps = Readonly<{
  children: React.ReactNode;
  lang: string;
}>;

export async function RootLayoutShell({ children, lang }: RootLayoutShellProps) {
  const catalog = await readCatalog();

  return (
    <html lang={lang} className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground">
        <ThemeProvider>
          <TooltipProvider>
            <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(64,123,255,0.18),transparent_30%),linear-gradient(180deg,rgba(6,23,66,0.08),transparent_30%)]">
              <SiteHeader totalEntries={catalog.total_entries} />
              {children}
            </div>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
