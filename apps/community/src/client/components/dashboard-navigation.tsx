import {ChevronDownIcon} from "lucide-react";
import {NavLink,useLocation} from "react-router";
import {m} from "@/paraglide/messages.js";
import {localizeHref} from "@/paraglide/runtime.js";
export function DashboardNavigation(){
 const location=useLocation();
 const groups=[{title:m.ui_dash_overview(),items:[["/dash",m.dash_overview()],["/dash/users",m.dash_users()]]},{title:m.ui_dash_content(),items:[["/dash/charts",m.dash_charts()],["/dash/discussions",m.site_discussions_admin()],["/dash/lists",m.library_dash_title()],["/dash/featured",m.site_featured()],["/dash/notices",m.site_notices()]]},{title:m.ui_dash_governance(),items:[["/dash/governance",m.governance_title()],["/dash/appeals",m.governance_appeals_title()],["/dash/reports",m.dash_reports()],["/dash/audit",m.governance_audit_title()]]},{title:m.ui_dash_operations(),items:[["/dash/status",m.dash_status()]]}];
 const links=<>{groups.map(group=><nav key={group.title} aria-label={group.title} className="community-nav-group"><p className="community-nav-label">{group.title}</p>{group.items.map(([href,label])=><NavLink key={href} to={localizeHref(href)} end={href==="/dash"} className={({isActive})=>`community-side-link ${isActive?"is-active":""}`}>{label}</NavLink>)}</nav>)}</>;
 return <aside className="community-dash-nav"><div className="hidden lg:block">{links}</div><details key={location.pathname} className="community-mobile-sections lg:hidden"><summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-medium">{m.dash_title()}<ChevronDownIcon className="size-4" aria-hidden="true"/></summary><div className="grid gap-3 border-t p-3 sm:grid-cols-2">{links}</div></details></aside>;
}
