import { LinksView } from "@/components/site/links-view";
import { buildLinksPageMetadata } from "@/lib/page-metadata";

export const metadata = buildLinksPageMetadata("zh");

export default function LinksPage() {
  return <LinksView locale="zh" />;
}
