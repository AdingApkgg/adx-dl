import { AboutView } from "@/components/site/about-view";
import { buildAboutPageMetadata } from "@/lib/page-metadata";

export const metadata = buildAboutPageMetadata("zh");

export default function AboutPage() {
  return <AboutView locale="zh" />;
}
