import { CommunityView } from "@/components/site/community-view";
import { buildCommunityPageMetadata } from "@/lib/page-metadata";

export const metadata = buildCommunityPageMetadata("zh");

export default function CommunityPage() {
  return <CommunityView locale="zh" />;
}
