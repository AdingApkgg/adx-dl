import { EmptyState } from "../components/ui-states";
import {Link} from "react-router";
import {m} from "@/paraglide/messages.js";
import {localizeHref} from "@/paraglide/runtime.js";
import {PageTitle} from "../components/page-title";
import type {Route} from "./+types/help";
const topics=()=>[
 ["governance",m.governance_my_title(),m.governance_help()],
 ["search",m.discovery_search_label(),m.discovery_help()],
 ["author",m.author_workbench(),m.author_help()],
 ["upload",m.site_help_upload_title(),m.site_help_upload_body()],
 ["publication",m.site_help_publication_title(),m.site_help_publication_body()],
 ["practice",m.site_help_practice_title(),m.site_help_practice_body()],
 ["downloads",m.download_title(),m.download_help()],
 ["library",m.library_title(),m.library_help()],
 ["community",m.site_help_community_title(),m.site_help_community_body()],
];
export const meta=()=>[{title:m.site_help()}];
const destinations:Record<string,string>={governance:"/me/governance",search:"/search",author:"/me/workbench",upload:"/me/charts/new",publication:"/me/charts",practice:"/charts",downloads:"/downloads",library:"/me/library",community:"/forum"};
export default function Help({params}:Route.ComponentProps){const all=topics(),rows=all.filter(([key])=>!params.topic||key===params.topic);return <main className="community-help-page space-y-6"><PageTitle description={m.ui_help_intro()}>{m.site_help()}</PageTitle><div className="community-help-layout"><nav aria-label={m.ui_help_navigation()} className="community-help-topics"><Link aria-current={!params.topic?"page":undefined} to={localizeHref('/help')}>{m.ui_help_all()}</Link>{all.map(([key,title])=><Link key={key} aria-current={params.topic===key?"page":undefined} to={localizeHref(`/help/${key}`)}>{title}</Link>)}</nav><div className="min-w-0 space-y-6">{rows.length?rows.map(([key,title,body])=><section key={key} className="community-panel space-y-4" id={`help-${key}`}><h2 className="community-section-title">{title}</h2><p className="whitespace-pre-line break-words text-sm leading-7">{body}</p><Link className="community-inline-action" to={localizeHref(destinations[key])}>{m.ui_help_continue({topic:title})}</Link></section>):<EmptyState title={m.site_help_missing()}><Link className="community-inline-action" to={localizeHref('/help')}>{m.ui_help_all()}</Link></EmptyState>}</div></div></main>;}
