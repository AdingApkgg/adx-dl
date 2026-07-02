import { VersionsIndexView } from "@/components/site/version-views";
import { readVersionGroups } from "@/lib/catalog";
import { buildVersionsPageMetadata } from "@/lib/page-metadata";

export const metadata = buildVersionsPageMetadata("zh");

// Tiles only need name/slug/icon/count; the per-version download specs load
// lazily from /versions/specs.json when select mode is entered.
export default async function VersionsPage() {
  const groups = await readVersionGroups();
  return <VersionsIndexView groups={groups} locale="zh" />;
}
