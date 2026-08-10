import { MusicView } from "@/components/site/music-view";
import { readCatalog } from "@/lib/catalog";
import { musicVersionSummaries } from "@/lib/music-playlists";
import { buildMusicPageMetadata } from "@/lib/page-metadata";

export const metadata = buildMusicPageMetadata("zh");

export default async function MusicPage() {
  return <MusicView versions={musicVersionSummaries(await readCatalog())} locale="zh" />;
}
