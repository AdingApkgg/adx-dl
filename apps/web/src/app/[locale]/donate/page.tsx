import type { Metadata } from "next";

import { DonateView } from "@/components/site/donate-view";
import { buildDonatePageMetadata } from "@/lib/page-metadata";

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
  return buildDonatePageMetadata(getPrefixedRouteLocale(locale));
}

export default async function LocalizedDonatePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <DonateView locale={getPrefixedRouteLocale(locale)} />;
}
