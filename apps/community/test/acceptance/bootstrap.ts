import { chown, stat, writeFile } from "node:fs/promises";
import { makeSignature } from "better-auth/crypto";
import { Client } from "pg";
import { resetTestDatabase, testDbHandle, assertTestDatabaseUrl } from "../../src/server/testing/test-db";
import { testSender } from "../../src/server/testing/test-boss";
import { user, session, profiles } from "../../src/server/db/schema";
import { initializeStorageState } from "../../ops/backup/initialize";
import { createS3Driver } from "../../src/server/storage/s3";
import { parseStorageEnv } from "../../src/server/storage/env";
import { storageFixtureConfig } from "../storage/fixture";

if (process.argv[2] === "restore-ready") {
  for (const key of ["TEST_DATABASE_URL", "STORAGE_TEST_TARGET_DATABASE_URL"])
    assertTestDatabaseUrl(process.env[key] ?? "");
  const config = await storageFixtureConfig("web");
  for (const endpoint of [config.endpoint, process.env.STORAGE_TEST_TARGET_ENDPOINT!]) {
    const driver = createS3Driver({ ...config, endpoint });
    const deadline = Date.now() + 45000;
    for (;;) {
      try { await driver.ready(AbortSignal.timeout(2000)); break; } catch {
        if (Date.now() >= deadline) throw new Error("ACCEPTANCE_STORAGE_NOT_READY");
        await Bun.sleep(500);
      }
    }
  }
  console.log("ISOLATED_RESTORE_INFRA_READY");
  process.exit(0);
}

assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
assertTestDatabaseUrl(process.env.TEST_DATABASE_URL ?? "");
if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("ACCEPTANCE_DATABASE_MISMATCH");
const driver = createS3Driver(parseStorageEnv(process.env, "backup"));
const deadline = Date.now() + 45000;
for (;;) {
  try { await driver.ready(AbortSignal.timeout(2000)); break; } catch {
    if (Date.now() >= deadline) throw new Error("ACCEPTANCE_STORAGE_NOT_READY");
    await Bun.sleep(500);
  }
}
const admin = new Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
try { await admin.query("create database community_storage_restore_source_test owner community"); }
finally { await admin.end(); }
let boss: Awaited<ReturnType<typeof testSender>> | undefined;
let handle: ReturnType<typeof testDbHandle> | undefined;
try {
  await resetTestDatabase();
  boss = await testSender();
  await initializeStorageState();
  handle = testDbHandle();
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("ACCEPTANCE_AUTH_SECRET_REQUIRED");
  const owner = await stat("/acceptance-fixture");
  for (const [name, file] of [["Acceptance owner", "session-cookie"], ["Other acceptance owner", "other-session-cookie"]]) {
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    await handle.db.insert(user).values({ id, name, email: `${id}@placeholder.invalid` });
    await handle.db.insert(profiles).values({ userId: id, bio: "Synthetic isolated acceptance account", onboardedAt: new Date() });
    await handle.db.insert(session).values({ userId: id, token, expiresAt: new Date(Date.now() + 86400000) });
    const cookie = `adxc.session_token=${encodeURIComponent(`${token}.${await makeSignature(token, secret)}`)}`;
    await writeFile(`/acceptance-fixture/${file}`, cookie + "\n", { mode: 0o600 });
    await chown(`/acceptance-fixture/${file}`, owner.uid, owner.gid);
  }
  console.log("SYNTHETIC_ACCEPTANCE_ACCOUNTS_READY");
} finally {
  await boss?.stop({ graceful: false });
  await handle?.pool.end();
}
