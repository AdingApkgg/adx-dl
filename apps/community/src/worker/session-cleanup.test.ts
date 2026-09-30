import { beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { shortId } from "@/server/auth/short-id";
import { session, user, verification } from "@/server/db/schema";
import { resetTestDatabase, testDbHandle } from "@/server/testing/test-db";
import { createLogger } from "@/shared/log";

import { cleanupExpiredAuthRows, runSessionCleanup } from "./session-cleanup";

const HOUR_MS = 3_600_000;

beforeAll(async () => {
  await resetTestDatabase();
}, 30_000);

describe("每天清理过期的会话和 verification", () => {
  test("删掉过期的，留下没过期的", async () => {
    const { db } = testDbHandle();
    const userId = shortId();
    await db.insert(user).values({ id: userId, name: "测试", email: `${userId}@placeholder.invalid` });
    await db.insert(session).values([
      { token: `expired-${crypto.randomUUID()}`, userId, expiresAt: new Date(Date.now() - HOUR_MS) },
      { token: `valid-${crypto.randomUUID()}`, userId, expiresAt: new Date(Date.now() + HOUR_MS) },
    ]);
    const verifications = await db
      .insert(verification)
      .values([
        { identifier: `expired-${crypto.randomUUID()}`, value: "x", expiresAt: new Date(Date.now() - HOUR_MS) },
        { identifier: `valid-${crypto.randomUUID()}`, value: "x", expiresAt: new Date(Date.now() + HOUR_MS) },
      ])
      .returning({ id: verification.id, identifier: verification.identifier });

    const removed = await cleanupExpiredAuthRows(db);

    expect(removed.sessions).toBeGreaterThanOrEqual(1);
    expect(removed.verifications).toBeGreaterThanOrEqual(1);
    const leftSessions = await db
      .select({ token: session.token })
      .from(session)
      .where(eq(session.userId, userId));
    expect(leftSessions.map((row) => row.token.split("-")[0])).toEqual(["valid"]);
    const leftVerifications = await db
      .select({ identifier: verification.identifier })
      .from(verification)
      .where(inArray(verification.id, verifications.map((row) => row.id)));
    expect(leftVerifications.map((row) => row.identifier.split("-")[0])).toEqual(["valid"]);
  }, 30_000);

  // 死信检查在 user.purge.sweep 里（purge-sweep.ts），这里只清理、只记一条。
  test("记一条 session_cleanup，带删掉的行数", async () => {
    const lines: string[] = [];

    await runSessionCleanup({ db: testDbHandle().db, log: createLogger((line) => lines.push(line)) });

    expect(lines.map((line) => JSON.parse(line) as Record<string, unknown>)).toEqual([
      {
        time: expect.any(String),
        level: "info",
        event: "session_cleanup",
        sessions: expect.any(Number),
        verifications: expect.any(Number),
      },
    ]);
  }, 30_000);
});
