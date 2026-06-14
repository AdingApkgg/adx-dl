import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { VersionDetailView } from "@/components/site/version-views";
import { readVersionGroup, readVersionSlugs } from "@/lib/catalog";
import { buildVersionDetailMetadata } from "@/lib/page-metadata";
import { prefixedLocales } from "@/lib/i18n";

import { getPrefixedRouteLocale } from "../../route-locale";

export const dynamicParams = false;

export async function generateStaticParams() {
  const slugs = await readVersionSlugs();
  return prefixedLocales.flatMap((locale) => slugs.map((version) => ({ locale, version })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; version: string }>;
}): Promise<Metadata> {
  const { locale, version } = await params;
  const group = await readVersionGroup(version);

  if (!group) {
    notFound();
  }

  return buildVersionDetailMetadata(
    getPrefixedRouteLocale(locale),
    group.name,
    version,
    group.entries.length
  );
}

export default async function LocalizedVersionDetailPage({
  params,
}: {
  params: Promise<{ locale: string; version: string }>;
}) {
  const { locale, version } = await params;
  const group = await readVersionGroup(version);

  if (!group) {
    notFound();
  }

  return (
    <VersionDetailView
      name={group.name}
      slug={version}
      imageIndex={group.imageIndex}
      entries={group.entries}
      locale={getPrefixedRouteLocale(locale)}
    />
  );
}
