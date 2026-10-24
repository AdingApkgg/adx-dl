import { MotionSurface } from "./motion-ui";
import type { ReactNode } from "react";
import { Button } from "@astrodx/ui/components/button";
import { CardContent, CardHeader, CardTitle } from "@astrodx/ui/components/card";
import { Link, isRouteErrorResponse, useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { isPublicUserId } from "@/shared/user-public-id";
import { ErrorCard } from "./error-card";

export function DashViewHeading({ title, description, count, id }: { title: string; description?: string; count?: number; id?: string }) {
  return <MotionSurface className="community-admin-view-heading"><div className="min-w-0 space-y-2"><h2 id={id} className="text-xl font-semibold tracking-tight">{title}</h2>{description ? <p className="max-w-3xl text-sm leading-7 text-muted-foreground">{description}</p> : null}</div>{count !== undefined ? <span className="community-status">{m.ui_admin_page_count({ count: String(count) })}</span> : null}</MotionSurface>;
}
export function DashEmpty({ children }: { children?: ReactNode }) { return <p role="status" className="community-empty">{children ?? m.dash_empty()}</p>; }
export function DashSection({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return <MotionSurface as="card" id={id} role="region" aria-label={title}><CardHeader><CardTitle asChild><h3>{title}</h3></CardTitle></CardHeader><CardContent>{children}</CardContent></MotionSurface>;
}
export function dashFilterHref(base: string, search: string, patch: Record<string, string | null>) {
  const params = new URLSearchParams(search); params.delete("cursor");
  for (const [key, value] of Object.entries(patch)) { if (value === null || value === "") params.delete(key); else params.set(key, value); }
  return localizeHref(base) + (params.size ? `?${params}` : "");
}
export function DashFacts({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return <dl className="grid gap-3 text-sm">{rows.map(row => <div key={row.label} className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-b border-border/50 pb-2 last:border-0">
    <dt className="text-muted-foreground">{row.label}</dt><dd className="min-w-0 break-all text-right font-medium">{row.value}</dd>
  </div>)}</dl>;
}
export function DashPager({ base, nextCursor }: { base: string; nextCursor: string | null }) {
  const location = useLocation(), params = new URLSearchParams(location.search), current = params.get("cursor") ?? ""; params.delete("cursor");
  const target = localizeHref(base), scope = `${target}?${params}`;
  const history: string[] = location.state?.dashScope === scope && Array.isArray(location.state?.cursors) ? location.state.cursors.filter((v: unknown): v is string => typeof v === "string" && (v === "" || isPublicUserId(v))).slice(-100) : [];
  function href(cursor?: string) { const p = new URLSearchParams(params); if (cursor) p.set("cursor", cursor); return target + (p.size ? `?${p}` : ""); }
  if (!current && !nextCursor) return null;
  return <nav aria-label={m.dash_pagination()} className="flex flex-wrap gap-3">
    {current ? <Button asChild variant="outline" className="min-h-11"><Link to={href(history.at(-1))} state={{ dashScope: scope, cursors: history.slice(0, -1) }}>{m.chart_previous()}</Link></Button> : null}
    {nextCursor ? <Button asChild variant="outline" className="min-h-11"><Link to={href(nextCursor)} state={{ dashScope: scope, cursors: [...history, current] }}>{m.chart_next()}</Link></Button> : null}
  </nav>;
}
export function DashError({ error }: { error: unknown }) {
  if (!isRouteErrorResponse(error) || error.status !== 403) return <ErrorCard error={error} />;
  return <section className="space-y-4 rounded-xl border p-6">
    <h1 className="text-xl font-semibold">{m.dash_denied_title()}</h1><p className="text-muted-foreground">{m.dash_denied_body()}</p>
    <Button asChild variant="outline"><Link to={localizeHref("/")}>{m.error_home()}</Link></Button>
  </section>;
}
