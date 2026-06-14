import { VersionsIndexView } from "@/components/site/version-views";
import { readVersionGroups } from "@/lib/catalog";
import { buildVersionsPageMetadata } from "@/lib/page-metadata";

export const metadata = buildVersionsPageMetadata("zh");

export default async function VersionsPage() {
  const groups = await readVersionGroups();
  return <VersionsIndexView groups={groups} locale="zh" />;
}
