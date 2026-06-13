import { SearchPageView } from "@/components/site/page-views";
import { readCatalogEntries } from "@/lib/catalog";
import type { Metadata } from "next";
import { buildSearchPageMetadata } from "@/lib/page-metadata";

import { generatePrefixedLocaleParams, getPrefixedRouteLocale } from "../route-locale";

export function generateStaticParams() {
  return generatePrefixedLocaleParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildSearchPageMetadata(getPrefixedRouteLocale(locale));
}

export default async function LocalizedSearchPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const entries = await readCatalogEntries();

  return <SearchPageView entries={entries} locale={getPrefixedRouteLocale(locale)} />;
}
