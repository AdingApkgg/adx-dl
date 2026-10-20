import { Link } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { PageTitle } from "../components/page-title";
import { ErrorCard } from "../components/error-card";
import { AppealCard, AppealComposer, governanceAction } from "../components/governance-ui";
import { PrivateDiscussionGuard, DiscussionDraftBoundary, DiscussionPager } from "../components/discussion-ui";
import { loadGovernance } from "../lib/governance";
import { dashDate } from "../lib/dash";
import type { Route } from "./+types/my-governance";
export { headers, shouldRevalidate } from "../lib/dash";
export async function loader({context,url}:Route.LoaderArgs){const appeals=url.searchParams.get('view')==='appeals',cursor=url.searchParams.get('cursor')??undefined;return loadGovernance(context,url,async api=>({view:appeals?'appeals' as const:'decisions' as const,decisions:appeals?null:await api.decisions(cursor),appeals:appeals?await api.appeals({cursor}):null}));}
export function meta(){return [{title:`${m.governance_my_title()} - ${m.site_name()}`},{name:'robots',content:'noindex, nofollow'}];}
export default function MyGovernance({loaderData}:Route.ComponentProps){const page=loaderData.page;return <PrivateDiscussionGuard userId={loaderData.userId}><DiscussionDraftBoundary><main className="min-w-0 space-y-6"><PageTitle description={m.governance_private_hint()}>{m.governance_my_title()}</PageTitle><nav className="flex min-h-11 flex-wrap gap-4" aria-label={m.governance_my_title()}><Link className="underline" to={localizeHref('/me/governance')}>{m.governance_decisions()}</Link><Link className="underline" to={`${localizeHref('/me/governance')}?view=appeals`}>{m.governance_my_appeals()}</Link><Link className="underline" to={localizeHref('/me/reports')}>{m.my_reports()}</Link></nav><p className="text-sm text-muted-foreground">{m.governance_no_restore()}</p>
 {page.decisions?<>{page.decisions.items.length?page.decisions.items.map(d=><article key={`${loaderData.userId}/${d.key}`} className="space-y-3 rounded-xl border p-4"><h2 className="font-semibold">{governanceAction(d.action)}</h2><p className="break-all text-xs">{m.governance_reference()} · {d.key}</p><p className="whitespace-pre-wrap break-words">{d.publicReason}</p><time className="text-xs" dateTime={d.createdAt}>{dashDate(d.createdAt)}</time><AppealComposer decision={d}/></article>):<p>{m.governance_empty()}</p>}<DiscussionPager nextCursor={page.decisions.nextCursor}/></>:null}
 {page.appeals?<>{page.appeals.items.length?page.appeals.items.map(a=><AppealCard key={`${loaderData.userId}/${a.id}`} appeal={a}/>):<p>{m.governance_empty()}</p>}<DiscussionPager nextCursor={page.appeals.nextCursor}/></>:null}<p className="text-xs text-muted-foreground">{m.governance_snapshot_hint()}</p></main></DiscussionDraftBoundary></PrivateDiscussionGuard>;}
export function ErrorBoundary({error}:Route.ErrorBoundaryProps){return <ErrorCard error={error}/>;}
