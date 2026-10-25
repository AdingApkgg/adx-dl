import { EmptyState } from "../components/ui-states";
import { Link } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { PageTitle } from "../components/page-title";
import { ErrorCard } from "../components/error-card";
import { AppealCard, AppealComposer, GovernanceNavigation, governanceAction } from "../components/governance-ui";
import { PrivateDiscussionGuard, DiscussionDraftBoundary, DiscussionPager } from "../components/discussion-ui";
import { loadGovernance } from "../lib/governance";
import { dashDate } from "../lib/dash";
import type { Route } from "./+types/my-governance";
export { headers, shouldRevalidate } from "../lib/dash";
export async function loader({context,url}:Route.LoaderArgs){const appeals=url.searchParams.get('view')==='appeals',cursor=url.searchParams.get('cursor')??undefined;return loadGovernance(context,url,async api=>({view:appeals?'appeals' as const:'decisions' as const,decisions:appeals?null:await api.decisions(cursor),appeals:appeals?await api.appeals({cursor}):null}));}
export function meta(){return [{title:`${m.governance_my_title()} - ${m.site_name()}`},{name:'robots',content:'noindex, nofollow'}];}
export default function MyGovernance({loaderData}:Route.ComponentProps){const page=loaderData.page;return <PrivateDiscussionGuard userId={loaderData.userId}><DiscussionDraftBoundary><main className="community-record-page min-w-0 space-y-6">
 <PageTitle description={m.governance_private_hint()}>{m.governance_my_title()}</PageTitle><GovernanceNavigation view={page.view}/>
 <p className="community-context-note">{m.governance_no_restore()}</p>
 {page.decisions?<>{page.decisions.items.length?<ul className="community-record-list">{page.decisions.items.map(d=><li key={`${loaderData.userId}/${d.key}`}><article className="community-panel space-y-4"><div className="community-section-heading"><h2 className="community-section-title">{governanceAction(d.action)}</h2><time className="text-xs text-muted-foreground" dateTime={d.createdAt}>{dashDate(d.createdAt)}</time></div><p className="whitespace-pre-wrap break-words text-sm leading-7">{d.publicReason}</p><AppealComposer decision={d}/><p className="break-all border-t pt-3 text-xs text-muted-foreground">{m.governance_reference()} · <code>{d.key}</code></p></article></li>)}</ul>:<EmptyState title={m.governance_empty()} description={m.ui_case_empty_hint()}><Link className="community-inline-action" to={localizeHref('/help/governance')}>{m.site_help()}</Link></EmptyState>}<DiscussionPager nextCursor={page.decisions.nextCursor}/></>:null}
 {page.appeals?<>{page.appeals.items.length?<ul className="community-record-list">{page.appeals.items.map(a=><li key={`${loaderData.userId}/${a.id}`}><AppealCard appeal={a}/></li>)}</ul>:<EmptyState title={m.governance_empty()} description={m.ui_case_empty_hint()}><Link className="community-inline-action" to={localizeHref('/me/governance')}>{m.governance_decisions()}</Link></EmptyState>}<DiscussionPager nextCursor={page.appeals.nextCursor}/></>:null}
 <p className="text-xs leading-6 text-muted-foreground">{m.governance_snapshot_hint()}</p></main></DiscussionDraftBoundary></PrivateDiscussionGuard>;}
export function ErrorBoundary({error}:Route.ErrorBoundaryProps){return <ErrorCard error={error}/>;}
