import { describe, expect, test } from "bun:test";

import { classifyStorageError, normalizePersistedFile } from "./persistence";

function baseRecord() {
  return {
    key: "job::track.mp3",
    jobId: "job",
    name: "track.mp3",
    url: "https://astrodx-charts.saop.cc/25/11951/track.mp3",
  };
}

describe("normalizePersistedFile", () => {
  test("accepts a current whole-file checkpoint, including a zero-byte file", () => {
    const blob = new Blob([]);

    expect(
      normalizePersistedFile({
        ...baseRecord(),
        complete: true,
        size: 0,
        blob,
      })
    ).toEqual({
      ...baseRecord(),
      complete: true,
      size: 0,
      blob,
    });
  });

  test("lazily accepts a legacy record only when every size proves it is complete", () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);

    expect(
      normalizePersistedFile({
        ...baseRecord(),
        etag: '"v1"',
        total: 3,
        received: 3,
        blob,
      })
    ).toEqual({
      ...baseRecord(),
      complete: true,
      size: 3,
      blob,
    });
  });

  test("preserves the route snapshot for a custom-source checkpoint", () => {
    const blob = new Blob([new Uint8Array([1])]);
    const sourceBaseUrl = "https://mirror.example.com/charts";

    expect(
      normalizePersistedFile({
        ...baseRecord(),
        sourceBaseUrl,
        complete: true,
        size: 1,
        blob,
      })
    ).toEqual({
      ...baseRecord(),
      sourceBaseUrl,
      complete: true,
      size: 1,
      blob,
    });
  });

  test("rejects legacy byte prefixes and inconsistent current records", () => {
    expect(
      normalizePersistedFile({
        ...baseRecord(),
        total: 3,
        received: 2,
        blob: new Blob([new Uint8Array([1, 2])]),
      })
    ).toBeNull();
    expect(
      normalizePersistedFile({
        ...baseRecord(),
        complete: true,
        size: 3,
        blob: new Blob([new Uint8Array([1, 2])]),
      })
    ).toBeNull();
  });
});

describe("classifyStorageError", () => {
  test("recognises a quota failure by name or message", () => {
    // Engines disagree on the shape: some throw a named DOMException, others a
    // plain Error whose message is the only clue.
    const named = new Error("write failed");
    named.name = "QuotaExceededError";
    expect(classifyStorageError(named)).toBe("quota");
    expect(classifyStorageError(new Error("The quota has been exceeded."))).toBe(
      "quota"
    );
  });

  test("treats anything else as an unknown storage failure", () => {
    expect(classifyStorageError(new Error("db closed"))).toBe("unknown");
    expect(classifyStorageError(null)).toBe("unknown");
  });
});
