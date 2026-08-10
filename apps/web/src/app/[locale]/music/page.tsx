import type { Metadata } from "next";

import { MusicView } from "@/components/site/music-view";
import { readCatalog } from "@/lib/catalog";
import { musicVersionSummaries } from "@/lib/music-playlists";
import { buildMusicPageMetadata } from "@/lib/page-metadata";

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
  return buildMusicPageMetadata(getPrefixedRouteLocale(locale));
}

export default async function LocalizedMusicPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <MusicView
      versions={musicVersionSummaries(await readCatalog())}
      locale={getPrefixedRouteLocale(locale)}
    />
  );
}
