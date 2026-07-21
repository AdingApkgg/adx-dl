import { notFound, permanentRedirect } from "next/navigation";

import { readVersionGroup, readVersionRouteIds } from "@/lib/catalog";
import { buildVersionFilterHref } from "@/lib/catalog-links";

export const dynamicParams = false;

export async function generateStaticParams() {
  const ids = await readVersionRouteIds();
  return ids.map((version) => ({ version }));
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

  // Preserve old bookmarks while removing the dedicated detail-page flow.
  permanentRedirect(buildVersionFilterHref(group.imageIndex, "zh"));
}
