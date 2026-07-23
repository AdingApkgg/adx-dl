import { readMusicPlaylistManifest } from "@/lib/music-playlists";

// Build-time, compact playlist manifest for the persistent music player.
// Rendered to /music/playlists.json under the static export.
export const dynamic = "force-static";

export async function GET() {
  return Response.json(await readMusicPlaylistManifest());
}
