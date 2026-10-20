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
  const revalidator = useRevalidator();
  return <main className="min-w-0 space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <PageTitle description={m.dash_admin_identity({ id: loaderData.publicId })}>{m.dash_title()}</PageTitle>
      <Button variant="outline" disabled={revalidator.state === "loading"} onClick={() => { void revalidator.revalidate(); }}>{revalidator.state === "loading" ? m.dash_refreshing() : m.dash_refresh()}</Button>
    </div>
    <div className="community-dash-grid"><DashboardNavigation/><div className="community-dash-content"><Outlet /></div></div>
  </main>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <DashError error={error} />; }
