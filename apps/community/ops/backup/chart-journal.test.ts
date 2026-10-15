import { expect, test } from "bun:test";
import { validJournalRecord } from "./journal";
test("versioned chart permission facts are accepted and malformed snapshots fail closed", () => {
  const fact = {
    sequence: 1,
    kind: "chart_permission",
    userId: null,
    fileId: null,
    sha256: null,
    generation: null,
    createdAt: new Date().toISOString(),
    payload: {
      version: 1,
      chartId: "12345678-1234-4234-8234-123456789012",
      revision: 2,
      publication: null,
    },
  };
  expect(validJournalRecord(fact as never)).toBe(true);
  expect(validJournalRecord({ ...fact, payload: { ...fact.payload, version: 2 } } as never)).toBe(
    false,
  );
  expect(
    validJournalRecord({
      ...fact,
      payload: { ...fact.payload, publication: { versionId: "bad" } },
    } as never),
  ).toBe(false);
});

test("permission and retained-user metadata use Unicode code-point bounds", async () => {
  const { permissionFact, retentionFact } = await import("../../src/shared/chart-journal");
  const fact = {
    version: 1,
    chartId: crypto.randomUUID(),
    revision: 1,
    publication: {
      versionId: crypto.randomUUID(),
      title: "😀".repeat(120),
      artist: "🎵".repeat(120),
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
  expect(permissionFact.safeParse(fact).success).toBe(true);
  expect(retentionFact.safeParse({ version: 1, retained: [fact] }).success).toBe(true);
  for (const field of ["title", "artist"]) {
    const invalid = { ...fact, publication: { ...fact.publication, [field]: "😀".repeat(121) } };
    expect(permissionFact.safeParse(invalid).success).toBe(false);
    expect(retentionFact.safeParse({ version: 1, retained: [invalid] }).success).toBe(false);
  }
});
