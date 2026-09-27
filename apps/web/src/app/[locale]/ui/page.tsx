import type { Metadata } from "next";

import { UiShowcaseView } from "@/components/site/ui-showcase-view";
import { readCatalogEntries } from "@/lib/catalog";
import { buildUiPageMetadata } from "@/lib/page-metadata";

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
  return buildUiPageMetadata(getPrefixedRouteLocale(locale));
}

export default async function LocalizedUiPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const entries = await readCatalogEntries();
  return <UiShowcaseView locale={getPrefixedRouteLocale(locale)} entries={entries} />;
}
