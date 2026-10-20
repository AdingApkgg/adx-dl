import { Card, CardContent, CardHeader, CardTitle } from "@astrodx/ui/components/card";
import { Link } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { GovernanceFilters, governanceSourceName, governanceStatus } from "../components/governance-ui";
import { DiscussionPager, PrivateDiscussionGuard } from "../components/discussion-ui";
import { DashError } from "../components/dash-ui";
import { loadGovernance, governanceFilters } from "../lib/governance";
import { dashDate } from "../lib/dash";
import { reportCategory } from "../lib/community-social";
import type { ReportCategory } from "@/shared/community-social";
import type { Route } from "./+types/dash-governance";
export { headers, shouldRevalidate } from "../lib/dash";
export async function loader({context,url}:Route.LoaderArgs){return loadGovernance(context,url,async api=>{const [overview,tickets]=await Promise.all([api.overview(),api.tickets(governanceFilters(url,['cursor','source','status']))]);return {overview,tickets};});}
export default function Governance({loaderData}:Route.ComponentProps){const {overview:o,tickets}=loaderData.page;const tiles:[string,number][]=[[m.governance_reports_open(),o.reportsOpen],[m.governance_appeals_open(),o.appealsOpen],[m.governance_overdue(),o.overdue],[m.governance_resolved_day(),o.resolved24h],[m.governance_actions_day(),o.actions24h]];
 return <PrivateDiscussionGuard userId={loaderData.userId} admin><section className="space-y-5"><h2 className="text-xl font-semibold">{m.governance_title()}</h2><p>{m.governance_ops_hint()}</p><div className="grid gap-3 sm:grid-cols-2">{tiles.map(([label,value])=><Card key={label}><CardHeader><CardTitle className="text-sm">{label}</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold tabular-nums">{value}</p></CardContent></Card>)}</div><p className="text-xs text-muted-foreground">{m.governance_oldest()} · {dashDate(o.oldestOpenAt)}<br/>{m.dash_captured_at()} · {dashDate(o.generatedAt)}</p><nav className="flex min-h-11 flex-wrap gap-4"><Link className="underline" to={localizeHref('/dash/appeals')}>{m.governance_appeals_title()}</Link><Link className="underline" to={localizeHref('/dash/audit')}>{m.governance_audit_title()}</Link></nav><h3 className="text-lg font-semibold">{m.governance_intake()}</h3><GovernanceFilters source/>{tickets.items.length?<ul className="list-none space-y-3 p-0">{tickets.items.map(t=><li key={`${t.source}/${t.id}`} className="space-y-2 rounded-xl border p-4"><p>{governanceSourceName(t.source)} · {reportCategory(t.category as ReportCategory)} · {governanceStatus(t.status)}</p><p className="break-all text-xs">{m.governance_reference()} · {t.id}</p><time className="text-xs" dateTime={t.createdAt}>{dashDate(t.createdAt)}</time><p><Link className="inline-flex min-h-11 items-center underline" to={localizeHref(t.href)}>{m.governance_open_queue()}</Link></p></li>)}</ul>:<p>{m.governance_empty()}</p>}<DiscussionPager nextCursor={tickets.nextCursor}/></section></PrivateDiscussionGuard>;
}
export function ErrorBoundary({error}:Route.ErrorBoundaryProps){return <DashError error={error}/>;}
