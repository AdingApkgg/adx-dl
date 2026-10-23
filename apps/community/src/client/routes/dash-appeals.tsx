import { m } from "@/paraglide/messages.js";
import { AppealCard, GovernanceFilters } from "../components/governance-ui";
import { PrivateDiscussionGuard, DiscussionDraftBoundary, DiscussionPager } from "../components/discussion-ui";
import { DashError, DashViewHeading, DashEmpty } from "../components/dash-ui";
import { loadGovernance, governanceFilters } from "../lib/governance";
import type { Route } from "./+types/dash-appeals";
export { headers, shouldRevalidate } from "../lib/dash";
export async function loader({context,url}:Route.LoaderArgs){return loadGovernance(context,url,api=>api.staffAppeals({status:'open',...governanceFilters(url,['cursor','status'])}));}
export default function Appeals({loaderData}:Route.ComponentProps){return <PrivateDiscussionGuard userId={loaderData.userId} admin><DiscussionDraftBoundary><section className="space-y-5"><DashViewHeading title={m.governance_appeals_title()} description={m.governance_no_restore()} count={loaderData.page.items.length} /><GovernanceFilters/>{loaderData.page.items.length?loaderData.page.items.map(a=><AppealCard key={`${loaderData.userId}/${a.id}`} appeal={a} staff/>):<DashEmpty>{m.governance_empty()}</DashEmpty>}<DiscussionPager nextCursor={loaderData.page.nextCursor}/><p className="text-xs text-muted-foreground">{m.governance_snapshot_hint()}</p></section></DiscussionDraftBoundary></PrivateDiscussionGuard>;}
export function ErrorBoundary({error}:Route.ErrorBoundaryProps){return <DashError error={error}/>;}
