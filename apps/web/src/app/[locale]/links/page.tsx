import type { Metadata } from "next";

import { LinksView } from "@/components/site/links-view";
import { buildLinksPageMetadata } from "@/lib/page-metadata";

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
  return buildLinksPageMetadata(getPrefixedRouteLocale(locale));
}

export default async function LocalizedLinksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <LinksView locale={getPrefixedRouteLocale(locale)} />;
}
