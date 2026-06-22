import { describe, expect, test } from "bun:test";

import type { CatalogEntry } from "@/lib/catalog-shared";

function buildEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "song-3",
    remote_dir_name: "song-3",
    title: "曲目 3",
    title_en: "Song 3",
    artist: "歌手 3",
    artist_en: "Artist 3",
    category: "Official",
    subcategory: "舞萌DX 2025",
    source_archive: "archive-3.adx",
    source_folder: "folder-3",
    version: "Ver.3",
    genre: "Anime",
    cabinet: "DX",
    short_id: "S3",
    bpm: 123,
    offset: null,
    download_mode: "mixed",
    download_url: "https://downloads.example.com/song-3.zip",
    source_url: "https://source.example.com/song-3",
    license_note: "license-3",
    files: {
      maidata: "maidata-3.txt",
      maidata_dx: "maidata-dx-3.txt",
      audio: "audio-3.mp3",
      background: "background-3.png",
      pv: "pv-3.mp4",
    },
    assets: {
      has_audio: true,
      has_background: true,
      has_pv: true,
      has_dx_chart: true,
    },
    media: {
      entry_base_url: "/covers/song-3",
      cover_url: "/covers/song-3/bg.jpg",
      audio_url: "/covers/song-3/track.mp3",
      pv_url: "/covers/song-3/pv.mp4",
    },
    difficulties: [
      { slot: 0, level: "12+", designer: "Designer 3" },
      { slot: 1, level: "13", designer: "CoDesigner 3" },
    ],
    imported_at: "2026-06-03T12:00:00.000Z",
    ...overrides,
  };
}

describe("structured data builders", () => {
  test("buildHomeStructuredData emits an Organization + WebSite @graph with EntryPoint SearchAction", async () => {
    const { buildHomeStructuredData } = await import("./structured-data");

    expect(buildHomeStructuredData("en")).toEqual({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": "https://adxdls.saop.cc/#organization",
          name: "ADX 谱面资源",
          url: "https://adxdls.saop.cc",
          logo: "https://adxdls.saop.cc/opengraph-image.png",
          sameAs: ["https://github.com/AdingApkgg/adx-dl"],
        },
        {
          "@type": "WebSite",
          "@id": "https://adxdls.saop.cc/#website",
          name: "ADX 谱面资源",
          description:
            "An unofficial AstroDX archive of maimai-style charts — per-song metadata, cover art, difficulty constants and BPM, ready to browse by version, search, preview online and download.",
          url: "https://adxdls.saop.cc/en",
          inLanguage: "en",
          publisher: { "@id": "https://adxdls.saop.cc/#organization" },
          potentialAction: {
            "@type": "SearchAction",
            target: {
              "@type": "EntryPoint",
              urlTemplate: "https://adxdls.saop.cc/en/search?q={search_term_string}",
            },
            "query-input": "required name=search_term_string",
          },
        },
      ],
    });
  });

  test("buildHomeFaqStructuredData emits a FAQPage with localized questions", async () => {
    const { buildHomeFaqStructuredData } = await import("./structured-data");

    const faq = buildHomeFaqStructuredData("en", 1561, 17) as {
      "@type": string;
      mainEntity: Array<{ "@type": string; name: string; acceptedAnswer: { text: string } }>;
    };

    expect(faq["@type"]).toBe("FAQPage");
    expect(faq.mainEntity).toHaveLength(4);
    expect(faq.mainEntity[0]["@type"]).toBe("Question");
    expect(faq.mainEntity[3].acceptedAnswer.text).toContain("1561");
    expect(faq.mainEntity[3].acceptedAnswer.text).toContain("17");
  });

  test("buildListingStructuredData emits CollectionPage + ItemList + BreadcrumbList", async () => {
    const { buildListingStructuredData } = await import("./structured-data");
    const entry = buildEntry();

    const data = buildListingStructuredData("en", [entry], "charts") as {
      "@graph": Array<Record<string, unknown>>;
    };

    const [collection, breadcrumb] = data["@graph"];
    expect(collection["@type"]).toBe("CollectionPage");
    expect(collection.isPartOf).toEqual({ "@id": "https://adxdls.saop.cc/#website" });
    expect(collection.mainEntity).toMatchObject({
      "@type": "ItemList",
      numberOfItems: 1,
    });
    expect(breadcrumb["@type"]).toBe("BreadcrumbList");
  });

  test("buildChartDetailStructuredData emits a fixed MusicRecording and BreadcrumbList", async () => {
    const { buildChartDetailStructuredData } = await import("./structured-data");
    const { buildChartDescription } = await import("./catalog-shared");
    const entry = buildEntry();
    const slug = entry.id;
    const detailUrl = `https://adxdls.saop.cc/charts/${slug}`;

    const nodes = buildChartDetailStructuredData("zh", entry) as Array<
      Record<string, unknown> & { additionalProperty?: Array<{ name: string; value: unknown }> }
    >;
    const recording = nodes.find((node) => node["@type"] === "MusicRecording") as Record<
      string,
      unknown
    > & { additionalProperty: Array<{ name: string; value: unknown }> };
    const video = nodes.find((node) => node["@type"] === "VideoObject") as Record<string, unknown>;
    const breadcrumb = nodes.find((node) => node["@type"] === "BreadcrumbList") as Record<
      string,
      unknown
    >;

    expect(recording).toMatchObject({
      "@type": "MusicRecording",
      "@id": `${detailUrl}#recording`,
      name: "曲目 3",
      url: detailUrl,
      inLanguage: "zh-CN",
      byArtist: { "@type": "MusicGroup", name: "歌手 3" },
      genre: "Anime",
      image: "https://adxdls.saop.cc/covers/song-3/bg.jpg",
      identifier: "song-3",
      isAccessibleForFree: true,
      isPartOf: { "@id": "https://adxdls.saop.cc/#website" },
    });
    // The fabricated duration:"PT0S" must be gone.
    expect(recording).not.toHaveProperty("duration");
    expect(recording.description).toBe(buildChartDescription(entry, "zh"));
    // BPM is emitted as a real number under the schema.org property name.
    expect(recording.additionalProperty).toEqual(
      expect.arrayContaining([
        { "@type": "PropertyValue", name: "beatsPerMinute", value: 123 },
        { "@type": "PropertyValue", name: "difficultyCount", value: 2 },
        { "@type": "PropertyValue", name: "levelRange", value: "12+–13" },
        { "@type": "PropertyValue", name: "maimaiSongId", value: "S3" },
      ])
    );
    expect(recording.additionalProperty.some((property) => property.name === "bpm")).toBe(false);

    // PV is exposed as a VideoObject for video rich results.
    expect(video).toMatchObject({
      "@type": "VideoObject",
      "@id": `${detailUrl}#pv`,
      contentUrl: "https://adxdls.saop.cc/covers/song-3/pv.mp4",
      thumbnailUrl: "https://adxdls.saop.cc/covers/song-3/bg.jpg",
    });

    expect(breadcrumb).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "首页", item: "https://adxdls.saop.cc/" },
        { "@type": "ListItem", position: 2, name: "曲库", item: "https://adxdls.saop.cc/charts" },
        { "@type": "ListItem", position: 3, name: "曲目 3", item: detailUrl },
      ],
    });
  });
});
