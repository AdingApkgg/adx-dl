import { describe, expect, test } from "bun:test";
import { unzipSync } from "fflate";

import { buildNestedArchiveBlob, type NestedChart } from "@/lib/adx-archive";
import { nestedArchiveFiles, zipArchiveBytes } from "@/lib/adx-archive-layout";
import { splitBatchArchives } from "./downloads-store";

const LIMIT = 2 ** 31 - 1;

function chart(name: string, size: number, groupDir = "maimai"): NestedChart {
  const blob = new Blob([name]);
  // Exercise multi-GiB accounting without allocating multi-GiB test buffers.
  Object.defineProperty(blob, "size", { value: size });
  return { name, groupDir, files: [{ name: "track.mp3", blob }] };
}

describe("batch archive size limits", () => {
  test("rejects an empty batch instead of completing without saving an archive", () => {
    expect(() => splitBatchArchives([], "collection")).toThrow("No charts selected");
  });

  test("size calculation matches real ZIP output including normalized Unicode paths", async () => {
    const charts = ["谱/面", "谱/面", "谱_面 (2)"].map((name) => ({
      name, groupDir: "./东方/Project",
      files: [{ name: "track.mp3", blob: new Blob(["data"]) }],
    }));
    const blob = await buildNestedArchiveBlob(charts, "zip", "./collection");
    expect(zipArchiveBytes(nestedArchiveFiles(charts, "./collection"))).toBe(blob.size);
  });

  test("splits before the ZIP32 entry-count limit even for tiny files", () => {
    const blob = new Blob();
    const files = Array.from({ length: 33_000 }, (_, index) => ({ name: `${index}`, blob }));
    const parts = splitBatchArchives([
      { name: "first", files }, { name: "second", files },
    ], "collection");
    expect(parts.map((part) => part.charts.length)).toEqual([1, 1]);
  });

  test("splits a single genre into numbered, independently readable archives", async () => {
    const charts = [chart("first", 1_200_000_000), chart("second", 1_200_000_000)];
    const parts = splitBatchArchives(charts, "maimai");
    expect(parts.map((part) => part.name)).toEqual(["maimai (1)", "maimai (2)"]);
    expect(parts.map((part) => part.charts.length)).toEqual([1, 1]);
    for (const [index, part] of parts.entries()) {
      const blob = await buildNestedArchiveBlob(part.charts);
      const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
      const name = charts[index].name;
      expect(Object.keys(entries)).toEqual([`maimai/${name}/track.mp3`]);
      expect(new TextDecoder().decode(entries[`maimai/${name}/track.mp3`])).toBe(name);
    }
  });

  test("includes UTF-8 ZIP headers and footer in the limit", () => {
    const name = "谱面";
    const path = `maimai/${name}/track.mp3`;
    const overhead = 22 + 92 + 2 * new TextEncoder().encode(path).length;
    const exact = chart(name, LIMIT - overhead);
    expect(splitBatchArchives([exact], "maimai")).toHaveLength(1);
    expect(() => splitBatchArchives([chart(name, LIMIT - overhead + 1)], "maimai"))
      .toThrow("Chart is too large");
    expect(splitBatchArchives([exact, chart("extra", 0)], "maimai")).toHaveLength(2);
  });

  test("keeps every file of a chart together and preserves order", () => {
    const first = chart("first", 800_000_000);
    first.files.push(chart("audio", 800_000_000).files[0]);
    const second = chart("second", 800_000_000);
    const parts = splitBatchArchives([first, second], "collection");
    expect(parts.map((part) => part.charts.map((entry) => entry.name)))
      .toEqual([["first"], ["second"]]);
    expect(parts[0].charts[0].files).toHaveLength(2);
  });

  test("numbers only groups that need splitting", () => {
    const parts = splitBatchArchives([
      chart("one", 1_200_000_000),
      chart("two", 1_200_000_000),
      chart("three", 10, "東方Project"),
    ], "collection");
    expect(parts.map((part) => part.name))
      .toEqual(["maimai (1)", "maimai (2)", "東方Project"]);
  });

  test("keeps small archive names and tar.gz grouping unchanged", () => {
    expect(splitBatchArchives([chart("one", 10)], "collection")[0].name)
      .toBe("collection");
    const parts = splitBatchArchives([
      chart("one", 1_200_000_000), chart("two", 1_200_000_000),
    ], "collection", "tar.gz");
    expect(parts).toHaveLength(1);
    expect(parts[0].name).toBe("collection");
  });

  test("keeps duplicate chart directory names unique across parts", () => {
    const parts = splitBatchArchives([
      chart("same", 1_200_000_000), chart("same", 1_200_000_000),
    ], "collection", "zip");
    expect(parts.flatMap((part) => part.charts.map((entry) => entry.name)))
      .toEqual(["same", "same (2)"]);
  });

  test("canonicalizes dot-and-space prefixes before sizing and deduplicating", () => {
    const parts = splitBatchArchives([
      chart(". . same", 1_200_000_000), chart("same", 1_200_000_000),
    ], "collection");
    expect(parts.flatMap((part) => nestedArchiveFiles(part.charts).map((file) => file.name)))
      .toEqual(["maimai/same/track.mp3", "maimai/same (2)/track.mp3"]);
  });

  test("includes duplicate-name suffixes when sizing a boundary archive", () => {
    const pathBytes = new TextEncoder().encode("maimai/same/track.mp3").length;
    const payload = LIMIT - 22 - 2 * (92 + 2 * pathBytes);
    const firstBytes = Math.floor(payload / 2);
    const parts = splitBatchArchives([
      chart(". same", firstBytes), chart("same", payload - firstBytes),
    ], "collection");
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(zipArchiveBytes(nestedArchiveFiles(part.charts))).toBeLessThanOrEqual(LIMIT);
    }
  });
});
