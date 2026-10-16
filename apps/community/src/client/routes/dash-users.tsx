import { Link } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { DashError, DashPager } from "../components/dash-ui";
import { textLinkClass } from "../components/page-title";
import { dashDate, loadDash } from "../lib/dash";
import type { Route } from "./+types/dash-users";
export { headers, shouldRevalidate } from "../lib/dash";
export async function loader({ context, url }: Route.LoaderArgs) { return loadDash(context, url, api => api.users(url.searchParams.get("cursor") || undefined)); }
export default function DashUsers({ loaderData: page }: Route.ComponentProps) {
  return <section className="space-y-4" aria-labelledby="dash-users-heading">
    <h2 id="dash-users-heading" className="text-lg font-semibold">{m.dash_users()}</h2>
    <p className="text-sm text-muted-foreground">{m.dash_users_hint()}</p>
    {page.items.length ? <ul className="grid list-none gap-3 p-0 lg:grid-cols-2">{page.items.map(user => <li key={user.publicId} className="min-w-0 space-y-2 rounded-xl border p-4">
      <div className="flex flex-wrap justify-between gap-2"><Link to={localizeHref(`/u/${user.publicId}`)} className={`${textLinkClass} break-words`}>{user.name} · #{user.publicId}</Link><span className="text-xs text-muted-foreground">{user.status === "active" ? m.dash_account_active() : m.dash_account_pending()}</span></div>
      <p className="text-sm text-muted-foreground">{m.dash_user_charts({ total: String(user.charts), published: String(user.publicCharts) })}</p>
      <p className="text-xs text-muted-foreground">{m.dash_joined_at({ date: dashDate(user.createdAt) })}</p>
    </li>)}</ul> : <p>{m.dash_empty()}</p>}
    <DashPager base="/dash/users" nextCursor={page.nextCursor} />
  </section>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <DashError error={error} />; }
