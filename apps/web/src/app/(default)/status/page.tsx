import { ServerStatusClient } from "@/components/site/server-status-client";
import { buildStatusPageMetadata } from "@/lib/page-metadata";

export const metadata = buildStatusPageMetadata("zh");

export default async function StatusPage() {
  return <ServerStatusClient locale="zh" />;
}
