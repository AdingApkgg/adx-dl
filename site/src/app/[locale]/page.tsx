import { HomePageView } from "@/components/site/page-views";
import { readCatalog } from "@/lib/catalog";
import type { Metadata } from "next";
import { buildHomePageMetadata } from "@/lib/page-metadata";

import { generatePrefixedLocaleParams, getPrefixedRouteLocale } from "./route-locale";

export function generateStaticParams() {
  return generatePrefixedLocaleParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildHomePageMetadata(getPrefixedRouteLocale(locale));
}

export default async function LocalizedHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const catalog = await readCatalog();

  return <HomePageView catalog={catalog} locale={getPrefixedRouteLocale(locale)} />;
}
