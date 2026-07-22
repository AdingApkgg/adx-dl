import { describe, expect, test } from "bun:test";

import { normalizePersistedFile } from "./persistence";

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
