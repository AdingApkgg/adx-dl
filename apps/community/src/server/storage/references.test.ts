import { expect, test, beforeAll } from "bun:test";
import { getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";
import {
  FILE_REFERENCES,
  registerFileReferences,
  hasFileReferences,
  hasPublicRepresentation,
  retainsFile,
} from "./references";
beforeAll(resetTestDatabase, 30000);
test("all actual schema foreign keys to files are classified as business or system bookkeeping", () => {
  const business: string[] = [];
  for (const table of Object.values(schema)) {
    if (!is(table, PgTable)) continue;
    for (const fk of getTableConfig(table).foreignKeys) {
      const ref = fk.reference();
      if (ref.foreignTable === schema.files && table !== schema.uploadSessions)
        business.push(getTableName(table));
    }
  }
  expect(business.sort()).toEqual(
    FILE_REFERENCES.map((e) => getTableName(e.referenceTable)).sort(),
  );
  expect(business).toContain("user_avatars");
});
test("mandatory deletion partner and all aggregate decisions participate; omissions/duplicates reject", async () => {
  const calls: string[] = [];
  const descriptor = {
    name: "test-only",
    referenceTable: schema.userAvatars,
    deletionPartner: "test-handler",
    references: async () => {
      calls.push("references");
      return true;
    },
    publicRepresentations: async () => {
      calls.push("public");
      return true;
    },
    retention: async () => {
      calls.push("retention");
      return true;
    },
  };
  const registry = registerFileReferences([descriptor]);
  const db = testDbHandle().db;
  expect(await hasFileReferences(db, "unused", registry)).toBe(true);
  expect(await hasPublicRepresentation(db, "unused", registry)).toBe(true);
  expect(await retainsFile(db, "unused", registry)).toBe(true);
  expect(calls).toEqual(["references", "public", "retention"]);
  for (const key of ["deletionPartner", "references", "publicRepresentations", "retention"]) {
    const broken = { ...descriptor, [key]: undefined };
    expect(() => registerFileReferences([broken as never])).toThrow();
  }
  expect(() => registerFileReferences([descriptor, descriptor])).toThrow();
});
