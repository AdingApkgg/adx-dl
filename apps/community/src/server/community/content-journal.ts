import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { communityContentFact, type CommunityContentFact } from "@/shared/community-content-journal";
import { communityContentStates, forumPublicIds, storageTombstones } from "../db/schema";
import type { Db } from "../db/client";
import type { DbTransaction, StorageContext } from "../storage/contracts";
import { awaitChartJournal } from "../charts/publication-journal";
function canonical(value: unknown): string {
  if (value === undefined) throw new TypeError("Undefined canonical value");
  if (value === null || typeof value !== "object") { const encoded = JSON.stringify(value); if (encoded === undefined) throw new TypeError("Invalid canonical value"); return encoded; }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).filter(key => (value as Record<string,unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(",")}}`;
}
export function communityHash(value: unknown) { return createHash("sha256").update(canonical(value)).digest("hex"); }
export async function readCommunityFact(db: Db | DbTransaction, entity: string, id: string) {
  const [row] = await db.select().from(communityContentStates).where(eq(communityContentStates.key,`${entity}:${id}`));
  return row ? {fact:communityContentFact.parse(row.fact),sequence:row.journalSequence} : null;
}
export async function recordCommunityFact(tx: DbTransaction, input: CommunityContentFact, userId?: string): Promise<number> {
  const fact = communityContentFact.parse(input), key = `${fact.entity}:${fact.id}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key},217))`);
  const prior = await readCommunityFact(tx,fact.entity,fact.id);
  if (prior && prior.fact.revision === fact.revision && communityHash(prior.fact) === communityHash(fact)) return prior.sequence;
  if (prior && (prior.fact.revision >= fact.revision || (["deleted","hidden"].includes(prior.fact.state) || (prior.fact.state==="root_removed" && fact.state!=="hidden")))) throw new Error("COMMUNITY_FACT_CONFLICT");
  const [event] = await tx.insert(storageTombstones).values({kind:"community_content",userId,payload:fact}).returning({sequence:storageTombstones.sequence});
  if (!event) throw new Error("COMMUNITY_FACT_MISSING");
  await tx.insert(communityContentStates).values({key,entity:fact.entity,entityId:fact.id,revision:fact.revision,fact,journalSequence:event.sequence})
    .onConflictDoUpdate({target:communityContentStates.key,set:{revision:fact.revision,fact,journalSequence:event.sequence,updatedAt:new Date()}});
  return event.sequence;
}
export const awaitCommunityJournal = (ctx: StorageContext, sequence: number) => awaitChartJournal(ctx,sequence);
export async function allocateForumId(tx: DbTransaction, topicId: string, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`forum_id:${topicId}`},217))`);
  let [row] = await tx.select().from(forumPublicIds).where(eq(forumPublicIds.topicId,topicId));
  if (!row) [row] = await tx.insert(forumPublicIds).values({topicId}).returning();
  if (!row) throw new Error("FORUM_ID_MISSING");
  const publicId = row.publicId.toString();
  const sequence = await recordCommunityFact(tx,{version:1,entity:"forum_id",id:topicId,revision:1,state:"allocated",publicId},userId);
  await tx.update(forumPublicIds).set({journalSequence:sequence}).where(eq(forumPublicIds.topicId,topicId));
  return {publicId,sequence};
}
