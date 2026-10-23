import { m } from "@/paraglide/messages.js";
import { GovernanceFilters, governanceAction, governanceKindName } from "../components/governance-ui";
import { PrivateDiscussionGuard, DiscussionPager } from "../components/discussion-ui";
import { DashError, DashViewHeading, DashEmpty } from "../components/dash-ui";
import { loadGovernance, governanceFilters } from "../lib/governance";
import { dashDate } from "../lib/dash";
import type { Route } from "./+types/dash-audit";
export { headers, shouldRevalidate } from "../lib/dash";
export async function loader({context,url}:Route.LoaderArgs){return loadGovernance(context,url,api=>api.audit(governanceFilters(url,['cursor','kind'])));}
export default function Audit({loaderData}:Route.ComponentProps){return <PrivateDiscussionGuard userId={loaderData.userId} admin><section className="space-y-5"><DashViewHeading title={m.governance_audit_title()} description={m.governance_audit_hint()} count={loaderData.page.items.length} /><GovernanceFilters kind/>{loaderData.page.items.length?<ol className="list-none space-y-3 p-0">{loaderData.page.items.map(e=><li key={e.id} className="space-y-2 rounded-xl border p-4"><p>{governanceKindName(e.kind)} · {governanceAction(e.action)}</p><p className="break-all text-xs">{e.targetType} · {e.targetId}</p><p className="text-sm">{m.governance_actor()} · {e.actorPublicId?`#${e.actorPublicId}`:m.dash_unknown()}</p><time className="text-xs" dateTime={e.createdAt}>{dashDate(e.createdAt)}</time></li>)}</ol>:<DashEmpty>{m.governance_empty()}</DashEmpty>}<DiscussionPager nextCursor={loaderData.page.nextCursor}/><p className="text-xs text-muted-foreground">{m.governance_snapshot_hint()}</p></section></PrivateDiscussionGuard>;}
export function ErrorBoundary({error}:Route.ErrorBoundaryProps){return <DashError error={error}/>;}
