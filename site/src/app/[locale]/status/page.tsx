import type { Metadata } from "next";

import { ServerStatusClient } from "@/components/site/server-status-client";
import { buildStatusPageMetadata } from "@/lib/page-metadata";

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
  return buildStatusPageMetadata(getPrefixedRouteLocale(locale));
}

export default async function LocalizedStatusPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <ServerStatusClient locale={getPrefixedRouteLocale(locale)} />;
}
