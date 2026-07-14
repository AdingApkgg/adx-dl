import { DonateView } from "@/components/site/donate-view";
import { buildDonatePageMetadata } from "@/lib/page-metadata";

export const metadata = buildDonatePageMetadata("zh");

export default function DonatePage() {
  return <DonateView locale="zh" />;
}
