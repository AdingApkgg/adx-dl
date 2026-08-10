import type { Metadata } from "next";

import "../globals.css";
import { RootLayoutShell, rootViewport } from "@/app/root-layout-shell";
import { getHtmlLang } from "@/lib/i18n";
import { resolveSiteUrl } from "@/lib/site-url";
import { webManifestPath } from "@/lib/web-manifest";

import { getPrefixedRouteLocale } from "./route-locale";

export const viewport = rootViewport;

const siteUrl = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
const siteDescription =
  "ADX 谱面资源 is an unofficial AstroDX chart archive with maimai-style catalog indexing, song metadata, cover art, difficulty data, online previews and downloads.";

// Per-locale, purely so each tree links its own install manifest — the title
// and description here are the layout-level defaults every page overrides.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  return {
    metadataBase: new URL(siteUrl),
    title: "ADX 谱面资源 | AstroDX Chart Archive",
    description: siteDescription,
    manifest: webManifestPath(getPrefixedRouteLocale(locale)),
  };
}

export default async function LocalizedRootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  const routeLocale = getPrefixedRouteLocale(locale);

  return (
    <RootLayoutShell lang={getHtmlLang(routeLocale)} locale={routeLocale}>
      {children}
    </RootLayoutShell>
  );
}
