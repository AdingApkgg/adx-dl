import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { ChartDetailPageView } from "@/components/site/page-views";
import { readEntryByRouteSlug, readRelatedEntries, readRouteSlugs } from "@/lib/catalog";
import { buildChartDetailMetadata } from "@/lib/page-metadata";

import {
  buildLocalizedDetailStaticParams,
  getPrefixedRouteLocale,
} from "../../route-locale";

export const dynamicParams = false;

export async function generateStaticParams() {
  const slugs = await readRouteSlugs();
  return buildLocalizedDetailStaticParams(slugs);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const entry = await readEntryByRouteSlug(slug);

  if (!entry) {
    notFound();
  }

  return buildChartDetailMetadata(getPrefixedRouteLocale(locale), entry);
}

export default async function LocalizedChartDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const entry = await readEntryByRouteSlug(slug);

  if (!entry) {
    notFound();
  }

  const related = await readRelatedEntries(entry);
  return (
    <ChartDetailPageView
      entry={entry}
      related={related}
      locale={getPrefixedRouteLocale(locale)}
    />
  );
}
