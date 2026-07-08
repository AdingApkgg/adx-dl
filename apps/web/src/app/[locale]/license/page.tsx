import type { Metadata } from "next";

import { LicenseView } from "@/components/site/license-view";
import { buildLicensePageMetadata } from "@/lib/page-metadata";

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
  return buildLicensePageMetadata(getPrefixedRouteLocale(locale));
}

export default async function LocalizedLicensePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <LicenseView locale={getPrefixedRouteLocale(locale)} />;
}
