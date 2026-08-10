import { ChangelogView } from "@/components/site/changelog-view";
import { readCatalog } from "@/lib/catalog";
import { buildChangelogPageMetadata } from "@/lib/page-metadata";

export const metadata = buildChangelogPageMetadata("zh");

export default async function ChangelogPage() {
  return <ChangelogView catalog={await readCatalog()} locale="zh" />;
}
