import type { Metadata } from "next";

import { SurveyView } from "@/components/site/survey-view";
import { buildSurveyPageMetadata } from "@/lib/page-metadata";

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
  return buildSurveyPageMetadata(getPrefixedRouteLocale(locale));
}

export default async function LocalizedSurveyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <SurveyView locale={getPrefixedRouteLocale(locale)} />;
}
