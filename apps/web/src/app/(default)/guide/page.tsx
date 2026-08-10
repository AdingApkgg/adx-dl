import { GuideView } from "@/components/site/guide-view";
import { buildGuidePageMetadata } from "@/lib/page-metadata";

export const metadata = buildGuidePageMetadata("zh");

export default function GuidePage() {
  return <GuideView locale="zh" />;
}
