import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { TEST_AUTH_SECRET } from "../testing/constants";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../app";
import { session, storageBackupStatus, user, userPublicIds } from "../db/schema";
import { testAppDeps } from "../testing/app-deps";
import { exportTestUserIds } from "../testing/user-public-ids";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";
import { dashPage, dashStatus, dashUsers } from "./dash";

const owners: string[] = [];
const db = testDbHandle().db;
beforeAll(resetTestDatabase, 30000);
afterAll(async () => {
  if (owners.length) await db.delete(user).where(inArray(user.id, owners));
  await db.delete(storageBackupStatus);
});
async function account() {
  const id = crypto.randomUUID();
  owners.push(id);
  await db.insert(user).values({ id, name: "Dashboard fixture", email: `${id}@private.invalid` });
  const token = crypto.randomUUID();
  await db.insert(session).values({ userId: id, token, expiresAt: new Date(Date.now() + 86400000), ipAddress: "198.51.100.42", userAgent: "private device" });
  const [identity] = await db.select().from(userPublicIds).where(eq(userPublicIds.userId, id));
  const signedToken = `${token}.${createHmac("sha256", TEST_AUTH_SECRET).update(token).digest("base64")}`;
  return { id, token: signedToken, publicId: identity.publicId.toString() };
}
function application(adminPublicIds: string[] = []) {
  const { deps } = testAppDeps();
  return createApp({ ...deps, services: { ...deps.services, adminPublicIds } });
}
const paths = ["access", "overview", "users", "charts", "status"];

test("direct dashboard APIs deny anonymous, nonadmin and unexported identities before accepting a durable active admin", async () => {
  const admin = await account(), regular = await account();
  const app = application([admin.publicId]);
  for (const path of paths) {
    const anonymous = await app.request(`/api/v1/dash/${path}`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toBe("private, no-store");
    expect((await app.request(`/api/v1/dash/${path}`, { headers: { authorization: `Bearer ${regular.token}` } })).status).toBe(403);
    expect((await app.request(`/api/v1/dash/${path}`, { headers: { authorization: `Bearer ${admin.token}` } })).status).toBe(403);
  }
  await exportTestUserIds();
  const headers = { authorization: `Bearer ${admin.token}` };
  const access = await app.request("/api/v1/dash/access", { headers });
  expect(access.status).toBe(200);
  expect(await access.json()).toEqual({ publicId: admin.publicId });
  expect((await application().request("/api/v1/dash/access", { headers })).status).toBe(403);
  await db.update(user).set({ status: "pending_deletion" }).where(eq(user.id, admin.id));
  expect((await app.request("/api/v1/dash/access", { headers })).status).toBe(403);
});

test("dashboard user pagination is numeric, bounded and never exposes auth or contact fields", async () => {
  const accounts = [];
  for (let i = 0; i < 4; i++) accounts.push(await account());
  await exportTestUserIds();
  const cursor = String(BigInt(accounts[0].publicId) - 1n);
  const first = await dashUsers(db, dashPage({ cursor, limit: "2" }));
  expect(first.items.map(row => row.publicId)).toEqual(accounts.slice(0, 2).map(row => row.publicId));
  expect(first.nextCursor).toBe(accounts[1].publicId);
  const second = await dashUsers(db, dashPage({ cursor: first.nextCursor!, limit: "2" }));
  expect(second.items.map(row => row.publicId)).toEqual(accounts.slice(2).map(row => row.publicId));
  expect(second.nextCursor).toBeNull();
  for (const row of [...first.items, ...second.items]) {
    expect(Object.keys(row).sort()).toEqual(["publicId", "name", "image", "status", "createdAt", "charts", "publicCharts"].sort());
    expect(JSON.stringify(row)).not.toContain("private.invalid");
    expect(JSON.stringify(row)).not.toContain("198.51.100.42");
  }
  const app = application([accounts[0].publicId]);
  for (const query of ["limit=0", "limit=51", "limit=NaN", "cursor=01", "cursor=9223372036854775808", "private=true"]) {
    expect((await app.request(`/api/v1/dash/users?${query}`, { headers: { authorization: `Bearer ${accounts[0].token}` } })).status).toBe(400);
  }
});

test("dashboard status distinguishes absent and stale backup evidence and redacts dependency failures", async () => {
  const { deps } = testAppDeps();
  const services = { ...deps.services, auth: deps.auth, log: deps.log, dashChecks: { database: async () => {}, storage: async () => { throw new Error("secret-token /private/storage/path"); } } };
  await db.delete(storageBackupStatus);
  const initial = await dashStatus(services);
  expect(initial.backup).toEqual({ status: "unknown", startedAt: null, finishedAt: null, lastSuccessAt: null, manifestSha256: null, originalCount: null, bytes: null });
  expect(initial.checks).toEqual([{ name: "database", status: "ok" }, { name: "storage", status: "unavailable" }]);
  expect(JSON.stringify(initial)).not.toContain("secret-token");
  expect(JSON.stringify(initial)).not.toContain("/private/storage/path");
  const lastSuccessAt = new Date("2026-10-01T00:00:00.000Z");
  await db.insert(storageBackupStatus).values({ runId: crypto.randomUUID(), status: "running", startedAt: new Date(Date.now() - 31 * 60000), lastSuccessAt, manifestSha256: "a".repeat(64), originalCount: 3, bytes: 1024 });
  expect((await dashStatus(services)).backup).toMatchObject({ status: "unknown", lastSuccessAt: lastSuccessAt.toISOString(), originalCount: 3, bytes: 1024 });
  await db.update(storageBackupStatus).set({ status: "failed", finishedAt: new Date() });
  expect((await dashStatus(services)).backup).toMatchObject({ status: "failed", lastSuccessAt: lastSuccessAt.toISOString() });
  await db.update(storageBackupStatus).set({ status: "running", startedAt: new Date(), finishedAt: null });
  expect((await dashStatus(services)).backup.status).toBe("running");
});
