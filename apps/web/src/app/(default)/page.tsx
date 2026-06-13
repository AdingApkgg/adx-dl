import { HomePageView } from "@/components/site/page-views";
import { readCatalog } from "@/lib/catalog";
import { buildHomePageMetadata } from "@/lib/page-metadata";

export const metadata = buildHomePageMetadata("zh");

export default async function Home() {
  const catalog = await readCatalog();
  return <HomePageView catalog={catalog} locale="zh" />;
}
