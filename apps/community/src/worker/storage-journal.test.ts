import { beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { storageJournalProgress } from "../server/db/schema";
import { resetTestDatabase } from "../server/testing/test-db";
import { readyContext } from "../../test/storage/ready-file";
beforeAll(resetTestDatabase, 30000);
test("missing encrypted journal consumer fails closed and never advances exported checkpoint", async () => {
  const { ctx, policy } = await readyContext();
  const mod = (await import("./storage-journal").catch(
    () => ({}),
  )) as typeof import("./storage-journal");
  expect(typeof mod.exportStorageJournal).toBe("function");
  const before = await ctx.db.select().from(storageJournalProgress);
  await expect(mod.exportStorageJournal(ctx)).rejects.toMatchObject({
    code: "STORAGE_UNAVAILABLE",
  });
  expect(await ctx.db.select().from(storageJournalProgress)).toEqual(before);
  const { storagePolicies } = await import("../server/db/schema");
  await ctx.db.delete(storagePolicies).where(eq(storagePolicies.id, policy.id));
});
