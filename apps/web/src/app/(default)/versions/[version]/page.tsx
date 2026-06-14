import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { VersionDetailView } from "@/components/site/version-views";
import { readVersionGroup, readVersionSlugs } from "@/lib/catalog";
import { buildVersionDetailMetadata } from "@/lib/page-metadata";

export const dynamicParams = false;

export async function generateStaticParams() {
  const slugs = await readVersionSlugs();
  return slugs.map((version) => ({ version }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ version: string }>;
}): Promise<Metadata> {
  const { version } = await params;
  const group = await readVersionGroup(version);

  if (!group) {
    notFound();
  }

  return buildVersionDetailMetadata("zh", group.name, version, group.entries.length);
}

export default async function VersionDetailPage({
  params,
}: {
  params: Promise<{ version: string }>;
}) {
  const { version } = await params;
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
      locale="zh"
    />
  );
}
