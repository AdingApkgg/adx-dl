import { Card, CardContent, CardHeader, CardTitle } from "@astrodx/ui/components/card";
import { Link } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { DashError, DashFacts, DashSection, DashViewHeading } from "../components/dash-ui";
import { textLinkClass } from "../components/page-title";
import { dashBytes, dashDate, loadDash } from "../lib/dash";
import type { Route } from "./+types/dash-overview";
export { headers, shouldRevalidate } from "../lib/dash";
export async function loader({ context, url }: Route.LoaderArgs) { return loadDash(context, url, api => api.overview()); }
export default function DashOverview({ loaderData: overview }: Route.ComponentProps) {
  const tiles = [{ label: m.dash_users_total(), value: overview.users, href: "/dash/users" }, { label: m.dash_public_total(), value: overview.publicCharts, href: "/dash/charts" }, { label: m.dash_moderated_total(), value: overview.moderatedCharts, href: "/dash/charts" }, { label: m.dash_uploads_active(), value: overview.activeUploads, href: "/dash/status" }];
  return <section className="space-y-5" aria-label={m.dash_overview()}>
    <DashViewHeading title={m.dash_overview()} description={m.ui_admin_overview_hint()} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{tiles.map(tile => <Card key={tile.label}><CardHeader><CardTitle asChild><h3 className="text-sm"><Link to={localizeHref(tile.href)} className={textLinkClass}>{tile.label}</Link></h3></CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold tabular-nums">{tile.value}</p></CardContent></Card>)}</div>
    <nav className="grid gap-3 sm:grid-cols-2" aria-label={m.ui_admin_shortcuts()}>{([["/dash/users",m.dash_users(),m.ui_admin_users_hint()],["/dash/charts",m.dash_charts(),m.dash_charts_hint()],["/dash/governance",m.governance_title(),m.governance_ops_hint()],["/dash/status",m.dash_status(),m.ui_admin_status_hint()]] as const).map(([href,title,description])=><Link key={href} className="community-admin-shortcut" to={localizeHref(href)}><span className="font-semibold">{title} →</span><span className="text-sm leading-6 text-muted-foreground">{description}</span></Link>)}</nav>
    <DashSection title={m.ui_admin_details()}><DashFacts rows={[
      { label: m.dash_users_active(), value: overview.activeUsers }, { label: m.dash_users_pending(), value: overview.pendingDeletionUsers },
      { label: m.dash_original_bytes(), value: dashBytes(overview.originalBytes) }, { label: m.dash_derived_bytes(), value: dashBytes(overview.derivedBytes) },
      { label: m.dash_captured_at(), value: dashDate(overview.capturedAt) },
    ]} /></DashSection>
  </section>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <DashError error={error} />; }
