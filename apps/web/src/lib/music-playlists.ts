import { readCatalog } from "@/lib/catalog";
import {
  resolveVersionIndex,
  type Catalog,
  type CatalogEntry,
} from "@/lib/catalog-shared";
import { entrySlug } from "@/lib/route-slug";
import { MAIMAI_VERSIONS } from "@/lib/version-image";

export type MusicTrack = {
  id: string;
  slug: string;
  title: string;
  titleEn?: string;
  artist: string;
  artistEn?: string;
  versionId: number;
  versionName: string;
  coverUrl: string;
  coverAvif?: string;
  coverWebp?: string;
  audioUrl: string;
};

export type MusicPlaylistManifest = {
  generatedAt: string;
  playlists: Record<string, MusicTrack[]>;
};

/**
 * Project one catalog entry into the compact shape used by the global music
 * player. Entries without a playable audio URL or a known version are omitted.
 */
export function projectMusicTrack(entry: CatalogEntry): MusicTrack | null {
  const audioUrl = entry.media.audio_url.trim();
  const versionId = resolveVersionIndex(entry);

  if (!entry.assets.has_audio || !audioUrl || versionId === null) {
    return null;
  }

  return {
    id: entry.id,
    slug: entrySlug(entry),
    title: entry.title,
    ...(entry.title_en ? { titleEn: entry.title_en } : {}),
    artist: entry.artist,
    ...(entry.artist_en ? { artistEn: entry.artist_en } : {}),
    versionId,
    versionName: entry.version,
    coverUrl: entry.media.cover_url,
    ...(entry.media.cover_avif ? { coverAvif: entry.media.cover_avif } : {}),
    ...(entry.media.cover_webp ? { coverWebp: entry.media.cover_webp } : {}),
    audioUrl,
  };
}

/** Return the playable tracks for one canonical maimai version id. */
export function musicTracksForVersion(
  catalog: Catalog,
  versionId: number
): MusicTrack[] {
  const tracks: MusicTrack[] = [];

  for (const entry of catalog.entries) {
    const track = projectMusicTrack(entry);
    if (track?.versionId === versionId) {
      tracks.push(track);
    }
  }

  return tracks;
}

export type MusicVersionSummary = {
  versionId: number;
  /** Canonical maimai version name, matching VersionGroup.name. */
  name: string;
  slug: string;
  /** Playable tracks, i.e. entries with audio — not the version's chart count. */
  count: number;
};

/**
 * Per-version playable-track counts, newest version first. Built from the
 * catalog at build time so /music can render its grid without waiting on the
 * ~700 KB playlist manifest; versions with no playable audio are dropped
 * because every card on that page is a play button and an empty one is a trap.
 */
export function musicVersionSummaries(catalog: Catalog): MusicVersionSummary[] {
  const counts = new Map<number, number>();

  for (const entry of catalog.entries) {
    const track = projectMusicTrack(entry);
    if (!track) {
      continue;
    }
    counts.set(track.versionId, (counts.get(track.versionId) ?? 0) + 1);
  }

  return [...MAIMAI_VERSIONS]
    .reverse()
    .map((version) => ({
      versionId: version.index,
      name: version.name,
      slug: version.slug,
      count: counts.get(version.index) ?? 0,
    }))
    .filter((version) => version.count > 0);
}

/** Build the compact, version-keyed manifest served to the global player. */
export function buildMusicPlaylistManifest(
  catalog: Catalog
): MusicPlaylistManifest {
  const playlists: Record<string, MusicTrack[]> = {};

  for (const entry of catalog.entries) {
    const track = projectMusicTrack(entry);
    if (!track) {
      continue;
    }

    const key = String(track.versionId);
    (playlists[key] ??= []).push(track);
  }

  return {
    generatedAt: catalog.generated_at,
    playlists,
  };
}

/** Read the generated catalog and project it into the player manifest. */
export async function readMusicPlaylistManifest(): Promise<MusicPlaylistManifest> {
  return buildMusicPlaylistManifest(await readCatalog());
}
