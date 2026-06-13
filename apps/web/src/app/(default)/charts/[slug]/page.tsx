import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { ChartDetailPageView } from "@/components/site/page-views";
import { readEntryByRouteSlug, readRouteSlugs } from "@/lib/catalog";
import { buildChartDetailMetadata } from "@/lib/page-metadata";

export const dynamicParams = false;

export async function generateStaticParams() {
  const slugs = await readRouteSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const entry = await readEntryByRouteSlug(slug);

  if (!entry) {
    notFound();
  }

  return buildChartDetailMetadata("zh", entry);
}

export default async function ChartDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const entry = await readEntryByRouteSlug(slug);

  if (!entry) {
    notFound();
  }

  return <ChartDetailPageView entry={entry} locale="zh" />;
}
