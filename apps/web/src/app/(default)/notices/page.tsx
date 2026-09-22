import { NoticesView } from "@/components/site/notices-view";
import { buildNoticesPageMetadata } from "@/lib/page-metadata";

export const metadata = buildNoticesPageMetadata("zh");

export default function NoticesPage() {
  return <NoticesView locale="zh" />;
}
