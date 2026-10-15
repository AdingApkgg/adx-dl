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
