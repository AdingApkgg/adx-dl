import { expect, test } from "bun:test";
import { chartPlainText, normalizeChartTags } from "./chart-metadata";
import { permissionFact, retentionFact } from "./chart-journal";

for (const max of [1000, 2000]) test(`plain text counts ${max} Unicode code points and rejects invalid PostgreSQL text`, () => {
  const value = "😀".repeat(max);
  expect(chartPlainText(value, max)).toBe(value);
  expect(() => chartPlainText(value + "a", max)).toThrow(RangeError);
  expect(chartPlainText("<script>not executed</script>\nline", max)).toContain("\nline");
  for (const invalid of ["\0", "\ud800", "\udfff", 42, null]) expect(() => chartPlainText(invalid, max)).toThrow(RangeError);
});
test("tags preserve display text, normalize keys, deduplicate before the eight-tag bound", () => {
  expect(normalizeChartTags([" ＡＢＣ ", "abc", "AbC", "日本語", "😀".repeat(20)])).toEqual([
    { key: "abc", label: "ＡＢＣ" }, { key: "日本語", label: "日本語" }, { key: "😀".repeat(20), label: "😀".repeat(20) },
  ]);
  expect(normalizeChartTags(Array.from({ length: 9 }, () => "same"))).toHaveLength(1);
  expect(normalizeChartTags(Array.from({ length: 8 }, (_, i) => `tag${i}`))).toHaveLength(8);
  expect(() => normalizeChartTags(Array.from({ length: 9 }, (_, i) => `tag${i}`))).toThrow(RangeError);
  expect(normalizeChartTags([])).toEqual([]);
});
test("tags reject controls, normalized slashes, URLs, oversized or malformed input", () => {
  for (const invalid of ["", " ", "a/b", "a\\b", "a／b", "a\nb", "a\u200bb", "https:example", "www.example.com", "example.com", "😀".repeat(21), "\ud800"]) {
    expect(() => normalizeChartTags([invalid])).toThrow(RangeError);
  }
  expect(() => normalizeChartTags(Array(65).fill("same"))).toThrow(RangeError);
  expect(() => normalizeChartTags("tag")).toThrow(RangeError);
});
function legacyPublication() { return { versionId: crypto.randomUUID(), title: "Legacy public title", artist: "", publishedAt: "2026-10-18T00:00:00.000Z", updatedAt: "2026-10-18T00:00:00.000Z" }; }
test("legacy permission, moderation and retained snapshots default new fields empty", () => {
  const publication = legacyPublication(), fact = { version: 1, chartId: crypto.randomUUID(), revision: 1, publication };
  const defaults = { description: "", credits: "", tags: [], releaseNote: "" };
  expect(permissionFact.parse(fact).publication).toEqual({ ...publication, ...defaults });
  expect(retentionFact.parse({ version: 1, retained: [fact] }).retained[0]?.publication).toEqual({ ...publication, ...defaults });
  const moderation = { revision: 2, actorId: "admin", actorPublicId: "1", reason: "Reason", createdAt: publication.updatedAt, publication, author: null };
  expect(permissionFact.parse({ ...fact, publicId: "2", publication: null, moderation }).moderation?.publication).toEqual({ ...publication, ...defaults });
});
test("publication facts persist bounded metadata and reject noncanonical or duplicate tags", () => {
  const fact = { version: 1, chartId: crypto.randomUUID(), revision: 3, publication: { ...legacyPublication(),
    description: "😀".repeat(2000), credits: "署名", releaseNote: "更新", tags: normalizeChartTags([" ＡＢＣ ", "日本語"]) } };
  expect(permissionFact.parse(fact).publication).toEqual(fact.publication);
  for (const changes of [{ description: "x".repeat(2001) }, { credits: "x".repeat(1001) }, { releaseNote: "x".repeat(1001) },
    { tags: [{ key: "ABC", label: "ABC" }] }, { tags: [{ key: "a", label: "a" }, { key: "a", label: "a" }] }]) {
    expect(permissionFact.safeParse({ ...fact, publication: { ...fact.publication, ...changes } }).success).toBe(false);
  }
});
