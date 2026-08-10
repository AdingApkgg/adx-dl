import { describe, expect, test } from "bun:test";

import type { CatalogEntry } from "@/lib/catalog-shared";
import { buildChangelogBatches } from "@/lib/changelog";

function buildEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "song-1",
    slug: "11951",
    remote_dir_name: "11951",
    title: "曲目 1",
    artist: "歌手 1",
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
    files: { maidata: "maidata.txt", maidata_dx: "", audio: "", background: "", pv: "" },
    assets: {
      has_audio: false,
      has_background: false,
      has_pv: false,
      has_dx_chart: false,
    },
    media: { entry_base_url: "", cover_url: "", audio_url: "", pv_url: "" },
    difficulties: [],
    imported_at: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildChangelogBatches", () => {
  test("groups by UTC import day, newest batch first", () => {
    const batches = buildChangelogBatches([
      buildEntry({ id: "a", imported_at: "2026-07-13T04:00:00.000Z" }),
      buildEntry({ id: "b", imported_at: "2026-08-02T09:00:00.000Z" }),
      buildEntry({ id: "c", imported_at: "2026-07-13T22:30:00.000Z" }),
    ]);

    expect(batches.map((batch) => [batch.date, batch.total])).toEqual([
      ["2026-08-02", 1],
      ["2026-07-13", 2],
    ]);
  });

  test("caps the preview and reports what it left out", () => {
    const entries = Array.from({ length: 5 }, (_, index) =>
      buildEntry({ id: `song-${index}`, short_id: String(100 + index) })
    );

    const [batch] = buildChangelogBatches(entries, { previewSize: 2 });

    expect(batch.preview).toHaveLength(2);
    expect(batch.hiddenCount).toBe(3);
    expect(batch.total).toBe(5);
    // Release order within the batch: highest song id first.
    expect(batch.preview.map((entry) => entry.short_id)).toEqual(["104", "103"]);
  });

  test("summarizes a batch's versions biggest-share first and caps the list", () => {
    const [batch] = buildChangelogBatches(
      [
        buildEntry({ id: "a", versionid: 21, version: "maimai DX BUDDiES" }),
        buildEntry({ id: "b", versionid: 21, version: "maimai DX BUDDiES" }),
        buildEntry({ id: "c", versionid: 26, version: "maimai DX CiRCLE PLUS" }),
        buildEntry({ id: "d", versionid: undefined, version: "no such version" }),
      ],
      { maxVersions: 2 }
    );

    expect(batch.versions).toEqual([
      { versionId: 21, name: "maimai DX BUDDiES", count: 2 },
      { versionId: 26, name: "maimai DX CiRCLE PLUS", count: 1 },
    ]);
    expect(batch.hiddenVersionCount).toBe(1);
  });

  test("names the untagged bucket Unknown so the view can localize it", () => {
    const [batch] = buildChangelogBatches([
      buildEntry({ id: "a", versionid: undefined, version: "no such version" }),
    ]);

    expect(batch.versions).toEqual([{ versionId: null, name: "Unknown", count: 1 }]);
    expect(batch.hiddenVersionCount).toBe(0);
  });

  test("skips entries with no usable import timestamp", () => {
    expect(
      buildChangelogBatches([
        buildEntry({ id: "a", imported_at: undefined }),
        buildEntry({ id: "b", imported_at: "" }),
        buildEntry({ id: "c", imported_at: "2026" }),
      ])
    ).toEqual([]);
  });
});
