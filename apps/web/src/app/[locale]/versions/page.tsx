import type { Metadata } from "next";

import { VersionsIndexView } from "@/components/site/version-views";
import { readVersionGroups } from "@/lib/catalog";
import { buildVersionsPageMetadata } from "@/lib/page-metadata";

import { generatePrefixedLocaleParams, getPrefixedRouteLocale } from "../route-locale";

export const dynamicParams = false;

export function generateStaticParams() {
  return generatePrefixedLocaleParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildVersionsPageMetadata(getPrefixedRouteLocale(locale));
}

export default async function LocalizedVersionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const groups = await readVersionGroups();
  return <VersionsIndexView groups={groups} locale={getPrefixedRouteLocale(locale)} />;
}
