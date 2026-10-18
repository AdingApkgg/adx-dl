import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { UUID_PATTERN } from "../uuid";
import { user } from "../db/schema";
import type { Db } from "../db/client";
import type { DbTransaction } from "../storage/contracts";
import { withStorageTransaction } from "../storage/transactions";
export type SocialPageInput = { cursor?: string; limit?: number };
export function socialPage(input: SocialPageInput, identity: string) {
  const limit = input.limit ?? 24;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new HTTPException(400);
  const scope = createHash("sha256").update(identity).digest("hex");
  let cursor: { at: string; id: string; scope: string } | undefined;
  if (input.cursor !== undefined) {
    try {
      if (input.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw new Error();
      cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
      if (!cursor || Object.keys(cursor).sort().join() !== "at,id,scope" || cursor.scope !== scope ||
        typeof cursor.at !== "string" || new Date(cursor.at).toISOString() !== cursor.at ||
        typeof cursor.id !== "string" || !UUID_PATTERN.test(cursor.id)) throw new Error();
    } catch { throw new HTTPException(400, { message: "Invalid page" }); }
  }
  return { limit, cursor, encode: (at: Date, id: string) => Buffer.from(JSON.stringify({ at: at.toISOString(), id, scope })).toString("base64url") };
}
export async function requireActiveSocialUser(db: Db, id: string): Promise<void> {
  const [account] = await db.select({ status: user.status }).from(user).where(eq(user.id, id));
  if (account?.status !== "active") throw new HTTPException(403);
}
/** Serialize caps and duplicate checks with account deletion and other social mutations. */
export async function withSocialUser<T>(db: Db, id: string, run: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return withStorageTransaction(db, async tx => {
    const [account] = await tx.select({ status: user.status }).from(user).where(eq(user.id, id)).for("update");
    if (account?.status !== "active") throw new HTTPException(403);
    return run(tx);
  });
}
