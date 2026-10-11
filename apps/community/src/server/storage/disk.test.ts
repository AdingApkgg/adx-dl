import { test, expect } from "bun:test";
import { storageFilesystemBytes } from "./disk";
test("actual pinned Bun Linux fragment count prevents 512-fold free-space overstatement", () => {
  expect(
    storageFilesystemBytes({ bsize: 2097152n, frsize: 4096n, blocks: 65526n, bavail: 65152n }),
  ).toEqual({ total: 268394496, available: 266862592 });
  expect(storageFilesystemBytes({ bsize: 4096, blocks: 65526, bavail: 65152 })).toEqual({
    total: 268394496,
    available: 266862592,
  });
  for (const invalid of [0, -1, NaN, Infinity, 0.5, 9007199254740992])
    expect(() =>
      storageFilesystemBytes({ bsize: 4096, frsize: invalid, blocks: 65526, bavail: 65152 }),
    ).toThrow("STORAGE_FILESYSTEM_INVALID");
  expect(() => storageFilesystemBytes({ bsize: 4096n, blocks: 2n ** 60n, bavail: 1n })).toThrow(
    "STORAGE_FILESYSTEM_INVALID",
  );
});
