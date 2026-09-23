import type { Metadata } from "next";

import { NoticesView } from "@/components/site/notices-view";
import { buildNoticesPageMetadata } from "@/lib/page-metadata";

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
  return buildNoticesPageMetadata(getPrefixedRouteLocale(locale));
}

export default async function LocalizedNoticesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <NoticesView locale={getPrefixedRouteLocale(locale)} />;
}
