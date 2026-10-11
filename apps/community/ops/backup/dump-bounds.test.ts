import { expect, test } from "bun:test";
import { parseDumpBounds } from "./dump-bounds";

test("each mandatory dump bound must be a positive safe integer before summing", () => {
  for (const [community, umami] of [
    ["0", "1073741824"],
    ["1073741824", "0"],
    ["-1073741824", "2147483648"],
    ["2147483648", "-1073741824"],
    ["0.5", "1.5"],
    ["1.5", "0.5"],
    ["9007199254740992", "1"],
    ["1", "9007199254740992"],
    ["9007199254740991", "1"],
    ["1", "9007199254740991"],
    [undefined, "1"],
    ["1", ""],
    ["NaN", "1"],
    ["1", "Infinity"],
  ]) {
    expect(() => parseDumpBounds(community, umami)).toThrow("STORAGE_CAPACITY_BOUND_MISSING");
  }
});

test("valid environment and numeric exporter bounds preserve the exact safe total", () => {
  expect(parseDumpBounds("1073741824", "2147483648")).toEqual({
    community: 1073741824, umami: 2147483648, total: 3221225472,
  });
  expect(parseDumpBounds(1, 1)).toEqual({ community: 1, umami: 1, total: 2 });
  expect(parseDumpBounds(Number.MAX_SAFE_INTEGER - 1, 1)).toEqual({
    community: Number.MAX_SAFE_INTEGER - 1, umami: 1, total: Number.MAX_SAFE_INTEGER,
  });
});

test("deploy preflight rejects an invalid bound before filesystem or service checks", async () => {
  const { preflightStorage } = await import("./preflight");
  const before = [process.env.STORAGE_COMMUNITY_DUMP_BOUND, process.env.STORAGE_UMAMI_DUMP_BOUND];
  try {
    for (const [community, umami] of [["0", "1073741824"], ["-1073741824", "2147483648"], ["0.5", "1.5"], ["9007199254740992", "1"], ["9007199254740991", "1"]]) {
      process.env.STORAGE_COMMUNITY_DUMP_BOUND = community;
      process.env.STORAGE_UMAMI_DUMP_BOUND = umami;
      await expect(preflightStorage()).rejects.toThrow("STORAGE_CAPACITY_BOUND_MISSING");
    }
  } finally {
    for (const [index, key] of ["STORAGE_COMMUNITY_DUMP_BOUND", "STORAGE_UMAMI_DUMP_BOUND"].entries()) {
      if (before[index] === undefined) delete process.env[key];
      else process.env[key] = before[index];
    }
  }
});
