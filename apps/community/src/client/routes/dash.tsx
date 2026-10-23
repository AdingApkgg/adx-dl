import { useQuery } from "@tanstack/react-query";
import { getRenderApi } from "../lib/browser";
import { meQuery } from "../queries/me";
import { Button } from "@astrodx/ui/components/button";
import { Outlet, useRevalidator } from "react-router";
import { m } from "@/paraglide/messages.js";
import { DashboardNavigation } from "../components/dashboard-navigation";
import { PageTitle } from "../components/page-title";
import { DashError } from "../components/dash-ui";
import { loadDash } from "../lib/dash";
import type { Route } from "./+types/dash";
export { headers, shouldRevalidate } from "../lib/dash";
export async function loader({ context, url }: Route.LoaderArgs) { return loadDash(context, url, api => api.access()); }
export function meta() { return [{ title: `${m.dash_title()} - ${m.site_name()}` }, { name: "robots", content: "noindex, nofollow" }]; }
export default function Dash({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator(), { data: me } = useQuery(meQuery(getRenderApi()));
  if (!me || me.status !== "active" || !me.isAdmin || me.publicId !== loaderData.publicId) return null;
  return <main className="community-admin-page min-w-0 space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <PageTitle description={m.ui_admin_intro()}>{m.dash_title()}</PageTitle>
      <div className="flex flex-wrap items-center gap-3"><span className="community-status">{m.dash_admin_identity({ id: loaderData.publicId })}</span><Button className="min-h-11" variant="outline" disabled={revalidator.state === "loading"} onClick={() => { void revalidator.revalidate(); }}>{revalidator.state === "loading" ? m.dash_refreshing() : m.dash_refresh()}</Button></div>
    </div>
    <div className="community-dash-grid"><DashboardNavigation/><div className="community-dash-content"><Outlet /></div></div>
  </main>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <DashError error={error} />; }
