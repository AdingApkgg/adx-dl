import { describe, expect, test } from "bun:test";

import type { Catalog, CatalogEntry } from "@/lib/catalog-shared";
import {
  buildMusicPlaylistManifest,
  musicTracksForVersion,
  projectMusicTrack,
} from "@/lib/music-playlists";

function buildEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "song-1",
    slug: "11951",
    remote_dir_name: "11951",
    title: "曲目 1",
    title_en: "Song 1",
    artist: "歌手 1",
    artist_en: "Artist 1",
    category: "Remote",
    subcategory: "maimai DX BUDDiES",
    source_archive: "",
    source_folder: "",
    version: "maimai DX BUDDiES",
    versionid: 21,
    genre: "maimai",
    cabinet: "DX",
    short_id: "11951",
    bpm: 180,
    offset: 0,
    download_mode: "onsite",
    download_url: "",
    source_url: "",
    license_note: "",
    files: {
      maidata: "maidata.txt",
      maidata_dx: "",
      audio: "track.mp3",
      background: "bg.png",
      pv: "",
    },
    assets: {
      has_audio: true,
      has_background: true,
      has_pv: false,
      has_dx_chart: false,
    },
    media: {
      entry_base_url: "https://media.example/21/11951/",
      cover_url: "https://media.example/21/11951/bg.png",
      cover_avif: "https://media.example/21/11951/bg.avif",
      cover_webp: "https://media.example/21/11951/bg.webp",
      audio_url: "https://media.example/21/11951/track.mp3",
      pv_url: "",
    },
    difficulties: [],
    ...overrides,
  };
}

function buildCatalog(entries: CatalogEntry[]): Catalog {
  return {
    generated_at: "2026-07-23T00:00:00.000Z",
    total_entries: entries.length,
    categories: { Remote: ["maimai DX BUDDiES"] },
    entries,
  };
}

describe("music playlist projection", () => {
  test("projects a playable catalog entry into the compact player shape", () => {
    expect(projectMusicTrack(buildEntry())).toEqual({
      id: "song-1",
      slug: "11951",
      title: "曲目 1",
      titleEn: "Song 1",
      artist: "歌手 1",
      artistEn: "Artist 1",
      versionId: 21,
      versionName: "maimai DX BUDDiES",
      coverUrl: "https://media.example/21/11951/bg.png",
      coverAvif: "https://media.example/21/11951/bg.avif",
      coverWebp: "https://media.example/21/11951/bg.webp",
      audioUrl: "https://media.example/21/11951/track.mp3",
    });
  });

  test("omits entries without playable audio or a resolvable version", () => {
    expect(
      projectMusicTrack(
        buildEntry({ assets: { ...buildEntry().assets, has_audio: false } })
      )
    ).toBeNull();
    expect(
      projectMusicTrack({
        ...buildEntry(),
        media: { ...buildEntry().media, audio_url: "   " },
      })
    ).toBeNull();
    expect(
      projectMusicTrack(
        buildEntry({ versionid: undefined, version: "unmapped version" })
      )
    ).toBeNull();
  });

  test("groups playable tracks by version id and preserves catalog order", () => {
    const first = buildEntry();
    const second = buildEntry({
      id: "song-2",
      slug: "22002",
      title: "曲目 2",
      version: "maimai DX PRiSM PLUS",
      versionid: 24,
    });
    const third = buildEntry({
      id: "song-3",
      slug: "11953",
      title: "曲目 3",
    });
    const silent = buildEntry({
      id: "silent",
      assets: { ...buildEntry().assets, has_audio: false },
    });
    const catalog = buildCatalog([first, second, silent, third]);

    const manifest = buildMusicPlaylistManifest(catalog);

    expect(manifest.generatedAt).toBe(catalog.generated_at);
    expect(Object.keys(manifest.playlists)).toEqual(["21", "24"]);
    expect(manifest.playlists["21"].map((track) => track.id)).toEqual([
      "song-1",
      "song-3",
    ]);
    expect(manifest.playlists["24"].map((track) => track.id)).toEqual(["song-2"]);
    expect(musicTracksForVersion(catalog, 24)).toEqual(manifest.playlists["24"]);
    expect(musicTracksForVersion(catalog, 26)).toEqual([]);
  });

  test("falls back to the canonical version name when versionid is absent", () => {
    const track = projectMusicTrack(
      buildEntry({
        versionid: undefined,
        version: "maimai DX CiRCLE",
        title_en: "",
        artist_en: "",
        slug: undefined,
        media: {
          ...buildEntry().media,
          cover_avif: "",
          cover_webp: "",
        },
      })
    );

    expect(track).toMatchObject({
      id: "song-1",
      slug: "song-1",
      versionId: 25,
      versionName: "maimai DX CiRCLE",
    });
    expect(track).not.toHaveProperty("titleEn");
    expect(track).not.toHaveProperty("artistEn");
    expect(track).not.toHaveProperty("coverAvif");
    expect(track).not.toHaveProperty("coverWebp");
  });
});
