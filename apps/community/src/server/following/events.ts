import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { FollowingUpdate } from "@/shared/following";
import type { DbTransaction, StorageContext } from "../storage/contracts";
import { communityPublicationEvents } from "../db/schema";
import { getPublicChartsByIds } from "../charts/publication";
import { requireActiveSocialUser } from "../services/social-page";
import { assertFollowingReady, effectiveFollow, exported, followingScope, followingPage, rows, stamp, type EventRow } from "./core";
import { recordPrivateFact } from "./journal";
/** Deterministic UUID shared with the SQL baseline, not an authentication identifier. */
export function publicationEventId(chartId:string,versionId:string) {
 const h=createHash("md5").update(`${chartId}/${versionId}`).digest("hex");
 const raw=h.slice(0,12)+"5"+h.slice(13,16)+"a"+h.slice(17);
 return `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
}
/** Called inside the explicit publication transaction, after its permission fact. */
export async function recordPublicationEvent(tx:DbTransaction,chartId:string,versionId:string,authorId:string,at:Date,permissionSequence:number) {
 const id=publicationEventId(chartId,versionId);
 const [previous]=await tx.select().from(communityPublicationEvents).where(eq(communityPublicationEvents.id,id));
 if(previous)return previous.journalSequence;
 const sequence=await recordPrivateFact(tx,{version:1,entity:"publication",revision:1,id,chartId,versionId,authorId,occurredAt:stamp(at),permissionSequence,notify:true});
 await tx.insert(communityPublicationEvents).values({id,chartId,versionId,authorId,occurredAt:at,permissionSequence,journalSequence:sequence,notify:true});
 return sequence;
}
export async function listFeed(ctx:StorageContext,userId:string,cursor?:string) {
 await requireActiveSocialUser(ctx.db,userId);await assertFollowingReady(ctx.db,userId);
 const p=followingPage(cursor,`feed:${userId}:${await followingScope(ctx.db,userId)}`);
 const result=await rows<EventRow>(ctx.db,sql`select e.* from community_publication_events e join community_follows f on f.author_id=e.author_id and f.user_id=${userId}
  join "user" a on a.id=e.author_id and a.status='active' join chart_publications cp on cp.chart_id=e.chart_id and cp.version_id=e.version_id
  where ${effectiveFollow()} and f.journal_sequence<=${exported} and e.journal_sequence<=${exported} and e.occurred_at>=clock_timestamp()-interval '90 days'
  ${p.cursor?sql`and (e.occurred_at,e.id)<(${p.cursor.at}::timestamptz,${p.cursor.id}::uuid)`:sql``}
  order by e.occurred_at desc,e.id desc limit 21`);
 // Current public authorization covers withdrawal, blocks, missing assets and account deletion.
 const charts=await getPublicChartsByIds(ctx,result.slice(0,20).map(e=>e.chart_id));
 const visible=new Map(charts.map(chart=>[chart.id,chart]));
 const items:FollowingUpdate[]=result.slice(0,20).flatMap(event=>{const chart=visible.get(event.chart_id);return chart&&chart.author?.id===event.author_id&&chart.versionId===event.version_id?[{id:event.id,occurredAt:stamp(event.occurred_at),chart}]:[];});
 const last=result[19];return {items,nextCursor:result.length>20&&last?p.encode(new Date(last.occurred_at),last.id):null};
}
