import { VersionsIndexView } from "@/components/site/version-views";
import { readVersionChartSpecs, readVersionGroups } from "@/lib/catalog";
import { buildVersionsPageMetadata } from "@/lib/page-metadata";

export const metadata = buildVersionsPageMetadata("zh");

export default async function VersionsPage() {
  const [groups, versionCharts] = await Promise.all([
    readVersionGroups(),
    readVersionChartSpecs(),
  ]);
  return <VersionsIndexView groups={groups} versionCharts={versionCharts} locale="zh" />;
}
