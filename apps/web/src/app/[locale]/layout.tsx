import type { Metadata } from "next";

import "../globals.css";
import { RootLayoutShell, rootViewport } from "@/app/root-layout-shell";
import { getHtmlLang } from "@/lib/i18n";
import { resolveSiteUrl } from "@/lib/site-url";

import { getPrefixedRouteLocale } from "./route-locale";

export const viewport = rootViewport;

const siteUrl = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
const siteDescription =
  "ADX 谱面资源 is an unofficial AstroDX chart archive with maimai-style catalog indexing, song metadata, cover art, difficulty data, online previews and downloads.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "ADX 谱面资源 | AstroDX Chart Archive",
  description: siteDescription,
  manifest: "/site.webmanifest",
};

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
