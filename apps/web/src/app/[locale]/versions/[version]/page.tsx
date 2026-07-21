import { notFound, permanentRedirect } from "next/navigation";

import { readVersionGroup, readVersionRouteIds } from "@/lib/catalog";
import { buildVersionFilterHref } from "@/lib/catalog-links";
import { prefixedLocales } from "@/lib/i18n";

import { getPrefixedRouteLocale } from "../../route-locale";

export const dynamicParams = false;

export async function generateStaticParams() {
  const ids = await readVersionRouteIds();
  return prefixedLocales.flatMap((locale) => ids.map((version) => ({ locale, version })));
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

  // Static redirect shim for previously published localized detail URLs.
  permanentRedirect(buildVersionFilterHref(group.imageIndex, getPrefixedRouteLocale(locale)));
}
