import { LicenseView } from "@/components/site/license-view";
import { buildLicensePageMetadata } from "@/lib/page-metadata";

export const metadata = buildLicensePageMetadata("zh");

export default function LicensePage() {
  return <LicenseView locale="zh" />;
}
