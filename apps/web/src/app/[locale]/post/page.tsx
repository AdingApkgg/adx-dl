import type { Metadata } from "next";

import { PostView } from "@/components/site/post-view";
import { buildPostPageMetadata } from "@/lib/page-metadata";

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
  return buildPostPageMetadata(getPrefixedRouteLocale(locale));
}

export default async function LocalizedPostPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <PostView locale={getPrefixedRouteLocale(locale)} />;
}
