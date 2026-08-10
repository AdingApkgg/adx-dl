import type { Metadata } from "next";

import { GuideView } from "@/components/site/guide-view";
import { buildGuidePageMetadata } from "@/lib/page-metadata";

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
  return buildGuidePageMetadata(getPrefixedRouteLocale(locale));
}

export default async function LocalizedGuidePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <GuideView locale={getPrefixedRouteLocale(locale)} />;
}
