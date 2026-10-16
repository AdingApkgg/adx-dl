import type { ReactNode } from "react";
import { Button } from "@astrodx/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@astrodx/ui/components/card";
import { Link, isRouteErrorResponse, useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { isPublicUserId } from "@/shared/user-public-id";
import { ErrorCard } from "./error-card";

export function DashSection({ title, children }: { title: string; children: ReactNode }) {
  return <Card><CardHeader><CardTitle asChild><h2>{title}</h2></CardTitle></CardHeader><CardContent>{children}</CardContent></Card>;
}
export function DashFacts({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return <dl className="grid gap-3 text-sm">{rows.map(row => <div key={row.label} className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-b border-border/50 pb-2 last:border-0">
    <dt className="text-muted-foreground">{row.label}</dt><dd className="min-w-0 break-all text-right font-medium">{row.value}</dd>
  </div>)}</dl>;
}
export function DashPager({ base, nextCursor }: { base: string; nextCursor: string | null }) {
  const location = useLocation();
  const current = new URLSearchParams(location.search).get("cursor") ?? "";
  const history: string[] = Array.isArray(location.state?.cursors) ? location.state.cursors.filter((v: unknown): v is string => typeof v === "string" && (v === "" || isPublicUserId(v))) : [];
  const previous = history.at(-1);
  const target = localizeHref(base);
  return <nav aria-label={m.dash_pagination()} className="flex flex-wrap gap-2">
    {current ? <Button asChild variant="outline"><Link to={previous ? `${target}?cursor=${encodeURIComponent(previous)}` : target} state={{ cursors: history.slice(0, -1) }}>{m.chart_previous()}</Link></Button> : null}
    {nextCursor ? <Button asChild variant="outline"><Link to={`${target}?cursor=${encodeURIComponent(nextCursor)}`} state={{ cursors: [...history, current] }}>{m.chart_next()}</Link></Button> : null}
  </nav>;
}
export function DashError({ error }: { error: unknown }) {
  if (!isRouteErrorResponse(error) || error.status !== 403) return <ErrorCard error={error} />;
  return <section className="space-y-4 rounded-xl border p-6">
    <h1 className="text-xl font-semibold">{m.dash_denied_title()}</h1><p className="text-muted-foreground">{m.dash_denied_body()}</p>
    <Button asChild variant="outline"><Link to={localizeHref("/")}>{m.error_home()}</Link></Button>
  </section>;
}
