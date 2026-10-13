import { MascotPageView } from "@/components/site/live2d/mascot-page-view";
import { buildLive2DPageMetadata } from "@/lib/page-metadata";

export const metadata = buildLive2DPageMetadata("zh");

export default function Live2DPage() {
  return <MascotPageView locale="zh" />;
}
