import type { Metadata } from "next";

import "../globals.css";
import { RootLayoutShell } from "@/app/root-layout-shell";
import { getHtmlLang } from "@/lib/i18n";
import { resolveSiteUrl } from "@/lib/site-url";

import { getPrefixedRouteLocale } from "./route-locale";

const siteUrl = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "AstroDX Archive",
  description: "Chart archive, indexing, and download portal for AstroDX collections.",
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

  return <RootLayoutShell lang={getHtmlLang(routeLocale)}>{children}</RootLayoutShell>;
}
