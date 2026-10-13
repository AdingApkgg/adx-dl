import type { Metadata } from "next";

import { MascotPageView } from "@/components/site/live2d/mascot-page-view";
import { buildLive2DPageMetadata } from "@/lib/page-metadata";

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
  return buildLive2DPageMetadata(getPrefixedRouteLocale(locale));
}

export default async function LocalizedLive2DPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <MascotPageView locale={getPrefixedRouteLocale(locale)} />;
}
