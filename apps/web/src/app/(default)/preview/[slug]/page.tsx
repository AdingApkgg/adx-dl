import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ChartPreviewPageView } from "@/components/site/chart-preview-page";
import { readCatalogEntries, readEntryByRouteSlug } from "@/lib/catalog";
import { entrySlug } from "@/lib/route-slug";
import { buildChartPreviewMetadata } from "@/lib/page-metadata";

export const dynamicParams = false;

export async function generateStaticParams() {
  const entries = await readCatalogEntries();
  const slugs = entries.filter((entry) => Boolean(entry.files.maidata)).map(entrySlug);
  return slugs.map((slug) => ({ slug }));
}

type Props = { params: Promise<{ slug: string }> };

async function resolvePage(props: Props) {
  const params = await props.params;
  const entry = await readEntryByRouteSlug(params.slug);
  if (!entry?.files.maidata) notFound();
  return { entry, locale: "zh" as import("@/lib/i18n").Locale };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { entry, locale } = await resolvePage(props);
  return buildChartPreviewMetadata(locale, entry);
}

export default async function ChartPreviewPage(props: Props) {
  const { entry, locale } = await resolvePage(props);
  return <ChartPreviewPageView entry={entry} locale={locale} />;
}
