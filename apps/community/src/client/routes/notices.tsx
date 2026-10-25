import { EmptyState } from "../components/ui-states";
import {Link,data} from "react-router";
import {m} from "@/paraglide/messages.js";
import {localizeHref} from "@/paraglide/runtime.js";
import {apiContext} from "@/shared/router-context";
import {siteApi} from "../queries/community-site";
import {SiteNoticeList} from "../components/site-notice-list";
import {PageTitle} from "../components/page-title";
import type {Route} from "./+types/notices";
export const headers=()=>({"Cache-Control":"private, no-store"});
export async function loader({context,url}:Route.LoaderArgs){return data(await siteApi(context.get(apiContext)).notices(url.searchParams.get("cursor")??undefined),{headers:headers()});}
export const meta=()=>[{title:m.site_notices()}];
export default function Notices({loaderData}:Route.ComponentProps){return <main className="community-reading space-y-6"><PageTitle>{m.site_notices()}</PageTitle>{loaderData.items.length?<SiteNoticeList items={loaderData.items}/>:<EmptyState title={m.site_no_notices()}><Link className="community-inline-action" to={localizeHref("/charts")}>{m.public_charts_title()}</Link></EmptyState>}{loaderData.nextCursor?<Link className="inline-flex min-h-11 items-center underline" to={`${localizeHref("/notices")}?cursor=${encodeURIComponent(loaderData.nextCursor)}`}>{m.chart_next()}</Link>:null}</main>;}
