import { describe, expect, test } from "bun:test";

import { storageHeadroom } from "./storage-estimate";

const MB = 1024 * 1024;

describe("storageHeadroom", () => {
  test("grades a payload that cannot fit as insufficient", () => {
    expect(storageHeadroom({ usage: 900 * MB, quota: 1000 * MB }, 200 * MB)).toEqual({
      level: "insufficient",
      availableBytes: 100 * MB,
    });
  });

  test("warns while the payload fits but leaves no room for the archive copy", () => {
    // The bytes exist twice at the moment of the save: as resumable checkpoints
    // and again inside the archive Blob being assembled.
    expect(storageHeadroom({ usage: 0, quota: 150 * MB }, 100 * MB)).toEqual({
      level: "tight",
      availableBytes: 150 * MB,
    });
    expect(
      storageHeadroom({ usage: 0, quota: 400 * MB }, 100 * MB).level
    ).toBe("ok");
  });

  test("stays silent when the browser reports nothing usable", () => {
    // An unsubstantiated warning would scare users off downloads that work.
    expect(storageHeadroom(null, 100 * MB)).toEqual({
      level: "ok",
      availableBytes: null,
    });
    expect(storageHeadroom({ usage: 0, quota: 0 }, 100 * MB)).toEqual({
      level: "ok",
      availableBytes: null,
    });
    expect(
      storageHeadroom({ usage: Number.NaN, quota: 1000 * MB }, 100 * MB).level
    ).toBe("ok");
  });

  test("never warns about a zero-byte download", () => {
    expect(storageHeadroom({ usage: 999 * MB, quota: 1000 * MB }, 0)).toEqual({
      level: "ok",
      availableBytes: MB,
    });
  });

  test("clamps a usage figure that already exceeds the quota", () => {
    expect(
      storageHeadroom({ usage: 1200 * MB, quota: 1000 * MB }, MB)
    ).toEqual({ level: "insufficient", availableBytes: 0 });
  });
});
