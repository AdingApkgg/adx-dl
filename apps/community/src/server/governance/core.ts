import { sql } from "drizzle-orm";
import type { GovernanceAudit, GovernanceOverview, GovernancePage, GovernanceQuery, GovernanceTicket } from "@/shared/governance";
import type { StorageContext } from "../storage/contracts";
import { governanceRead } from "./appeals";
import { governancePage, governanceStamp } from "./page";
const reports=sql`(select id,'chart'::text source,category,status,created_at from chart_reports
 union all select id,'discussion'::text,category,status,created_at from discussion_reports
 union all select id,'list'::text,category,status,created_at from chart_list_reports)`;
export async function governanceOverview(ctx:StorageContext):Promise<GovernanceOverview>{
 const [result]=await governanceRead<GovernanceOverview>(ctx,sql`with reports as (select * from ${reports} r),pending as (
 select created_at from reports where status='open' union all select created_at from governance_appeals where status='open')
 select (select count(*)::int from reports where status='open') "reportsOpen",
 (select count(*)::int from governance_appeals where status='open') "appealsOpen",
 (select count(*)::int from pending where created_at<statement_timestamp()-interval '72 hours') overdue,
 ${governanceStamp(sql`(select min(created_at) from pending)`)} "oldestOpenAt",
 ((select count(*) from chart_reports where resolved_at>statement_timestamp()-interval '24 hours')+
 (select count(*) from discussion_reports where resolved_at>statement_timestamp()-interval '24 hours')+
 (select count(*) from chart_list_reports where resolved_at>statement_timestamp()-interval '24 hours')+
 (select count(*) from governance_appeals where resolved_at>statement_timestamp()-interval '24 hours'))::int "resolved24h",
 (select count(*)::int from governance_audit_events where created_at>statement_timestamp()-interval '24 hours') "actions24h",
 ${governanceStamp(sql`statement_timestamp()`)} "generatedAt"`);return result;
}
export async function governanceTickets(ctx:StorageContext,input:GovernanceQuery):Promise<GovernancePage<GovernanceTicket>>{
 const status=input.status??"open",p=governancePage(input,`tickets:${status}:${input.source??"all"}`);
 const rr=await governanceRead<Omit<GovernanceTicket,"href">>(ctx,sql`select r.id,r.source,r.category,r.status,${governanceStamp(sql`r.created_at`)} "createdAt" from ${reports} r
 where (${!input.source} or source=${input.source??""}) and (${status}='all' or (${status}='open' and status='open') or (${status}='resolved' and status<>'open'))
 and ${p.condition(sql`created_at`,sql`id`,sql`source`)} order by created_at desc,id desc,source desc limit 21`);
 const selected=rr.slice(0,20),last=selected.at(-1);
 return {items:selected.map(r=>({...r,href:r.source==='chart'?`/dash/reports?status=${status}&ticket=${r.id}#report-${r.id}`:r.source==='discussion'?`/dash/discussions?view=reports&status=${status}&ticket=${r.id}#report-${r.id}`:`/dash/lists?view=reports&status=${status}&ticket=${r.id}#report-${r.id}`})),nextCursor:rr.length>20&&last?p.encode(last.createdAt,last.id,last.source):null};
}
export async function governanceAudit(ctx:StorageContext,input:GovernanceQuery):Promise<GovernancePage<GovernanceAudit>>{
 const p=governancePage(input,`audit:${input.kind??"all"}`);
 const rr=await governanceRead<GovernanceAudit>(ctx,sql`select id,kind,action,target_type "targetType",target_id "targetId",actor_public_id::text "actorPublicId",${governanceStamp(sql`created_at`)} "createdAt"
 from governance_audit_events where (${!input.kind} or kind=${input.kind??""}) and ${p.condition(sql`created_at`,sql`id`,sql`kind`)} order by created_at desc,id desc,kind desc limit 21`);
 const selected=rr.slice(0,20),last=selected.at(-1);return {items:selected,nextCursor:rr.length>20&&last?p.encode(last.createdAt,last.id,last.kind):null};
}
