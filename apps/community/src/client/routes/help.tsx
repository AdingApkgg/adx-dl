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
export default function Help({params}:Route.ComponentProps){const rows=topics().filter(([key])=>!params.topic||key===params.topic);return <main className="space-y-6"><PageTitle>{m.site_help()}</PageTitle><nav className="flex flex-wrap gap-4">{topics().map(([key,title])=><Link key={key} className="inline-flex min-h-11 items-center underline" to={localizeHref(`/help/${key}`)}>{title}</Link>)}</nav>{rows.length?rows.map(([key,title,body])=><section key={key} className="space-y-3 rounded-xl border p-4"><h2 className="text-lg font-semibold">{title}</h2><p className="whitespace-pre-line leading-relaxed">{body}</p></section>):<p>{m.site_help_missing()}</p>}<Link className="inline-flex min-h-11 items-center underline" to={localizeHref("/me/charts")}>{m.charts_title()}</Link></main>;}
