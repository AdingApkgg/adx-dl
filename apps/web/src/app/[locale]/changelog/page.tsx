import type { Metadata } from "next";

import { ChangelogView } from "@/components/site/changelog-view";
import { readCatalog } from "@/lib/catalog";
import { buildChangelogPageMetadata } from "@/lib/page-metadata";

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
  return buildChangelogPageMetadata(getPrefixedRouteLocale(locale));
}

export default async function LocalizedChangelogPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <ChangelogView catalog={await readCatalog()} locale={getPrefixedRouteLocale(locale)} />
  );
}
