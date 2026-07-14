import type { Metadata } from "next";

import { CommunityView } from "@/components/site/community-view";
import { buildCommunityPageMetadata } from "@/lib/page-metadata";

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
  return buildCommunityPageMetadata(getPrefixedRouteLocale(locale));
}

export default async function LocalizedCommunityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <CommunityView locale={getPrefixedRouteLocale(locale)} />;
}
