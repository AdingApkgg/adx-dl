import type { Metadata } from "next";

import { GuestbookView } from "@/components/site/guestbook-view";
import { buildGuestbookPageMetadata } from "@/lib/page-metadata";

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
  return buildGuestbookPageMetadata(getPrefixedRouteLocale(locale));
}

export default async function LocalizedGuestbookPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <GuestbookView locale={getPrefixedRouteLocale(locale)} />;
}
