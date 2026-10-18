import { Button } from "@astrodx/ui/components/button";
import { NavLink, Outlet, useRevalidator } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { PageTitle } from "../components/page-title";
import { DashError } from "../components/dash-ui";
import { loadDash } from "../lib/dash";
import type { Route } from "./+types/dash";
export { headers, shouldRevalidate } from "../lib/dash";
export async function loader({ context, url }: Route.LoaderArgs) { return loadDash(context, url, api => api.access()); }
export function meta() { return [{ title: `${m.dash_title()} - ${m.site_name()}` }, { name: "robots", content: "noindex, nofollow" }]; }
export default function Dash({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const tabs = [["/dash/discussions",m.site_discussions_admin()],["/dash/featured",m.site_featured()],["/dash/notices",m.site_notices()],["/dash", m.dash_overview()], ["/dash/users", m.dash_users()], ["/dash/charts", m.dash_charts()], ["/dash/status", m.dash_status()], ["/dash/reports", m.dash_reports()]];
  return <main className="min-w-0 space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <PageTitle description={m.dash_admin_identity({ id: loaderData.publicId })}>{m.dash_title()}</PageTitle>
      <Button variant="outline" disabled={revalidator.state === "loading"} onClick={() => { void revalidator.revalidate(); }}>{revalidator.state === "loading" ? m.dash_refreshing() : m.dash_refresh()}</Button>
    </div>
    <nav aria-label={m.dash_title()} className="flex flex-wrap gap-2 rounded-lg border p-2">{tabs.map(([path, title]) => <NavLink key={path} to={localizeHref(path)} end={path === "/dash"} className={({ isActive }) => `rounded-md px-3 py-2 text-sm font-medium ${isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{title}</NavLink>)}</nav>
    <Outlet />
  </main>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <DashError error={error} />; }
