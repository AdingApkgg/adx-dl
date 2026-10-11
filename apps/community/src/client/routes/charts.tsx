import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { dehydrate, HydrationBoundary, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { apiContext, queryClientContext } from "@/shared/router-context";
import { PageTitle, textLinkClass } from "../components/page-title";
import { getRenderApi } from "../lib/browser";
import { chartErrorMessage } from "../lib/chart-errors";
import { accountErrorRedirect } from "../lib/account-errors";
import { requireUser } from "../lib/require-user";
import { chartsQuery } from "../queries/charts";
import type { Route } from "./+types/charts";
export async function loader({ context, url }: Route.LoaderArgs) {
  await requireUser(context, url);
  const client = context.get(queryClientContext);
  await client.query(chartsQuery(context.get(apiContext)));
  return { dehydratedState: dehydrate(client) };
}
export function meta() { return [{ title: `${m.charts_title()} - ${m.site_name()}` }, { name: "robots", content: "noindex" }]; }
export default function Charts({ loaderData }: Route.ComponentProps) {
  return <HydrationBoundary state={loaderData.dehydratedState}><ChartList /></HydrationBoundary>;
}
function ChartList() {
  const location = useLocation();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const { data, error, isFetching } = useQuery(chartsQuery(getRenderApi(), cursors.at(-1)));
  useEffect(() => {
    if (!error) return;
    const target = accountErrorRedirect(error, `${location.pathname}${location.search}`);
    if (target) window.location.assign(target);
  }, [error, location.pathname, location.search]);
  return <main className="space-y-6">
    <PageTitle description={m.charts_private_hint()}>{m.charts_title()}</PageTitle>
    <Button asChild><Link to={localizeHref("/me/charts/new")}>{m.chart_new()}</Link></Button>
    {error ? <Alert variant="destructive">{chartErrorMessage(error)}</Alert> : null}
    {data ? <>
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>{m.chart_usage({ used: (data.usage.usedBytes / (1024 * 1024)).toFixed(2), quota: String(data.usage.quotaBytes / (1024 * 1024)) })}</p>
        {data.usage.reservedBytes ? <p>{m.chart_usage_reserved({ reserved: (data.usage.reservedBytes / (1024 * 1024)).toFixed(2) })}</p> : null}
      </div>
      {!data.items.length ? <p>{m.charts_empty()}</p> : <ul className="space-y-3">{data.items.map((chart) => <li key={chart.id} className="rounded-lg border p-4">
        <Link to={localizeHref(`/me/charts/${chart.id}`)} className={`${textLinkClass} font-semibold break-words`}>{chart.title}</Link>
        <p className="text-sm text-muted-foreground break-words">{chart.artist}</p>
        <p className="text-sm">{m.chart_difficulties()}: {chart.summary.difficulties.map((row) => `${row.difficulty} (${row.level ?? "—"})`).join(" · ")}</p>
        <time className="text-xs text-muted-foreground" dateTime={chart.updatedAt}>{chart.updatedAt.slice(0, 10)}</time>
      </li>)}</ul>}
      <div className="flex gap-2">
        {cursors.length > 1 ? <Button variant="outline" disabled={isFetching} onClick={() => setCursors((rows) => rows.slice(0, -1))}>{m.chart_previous()}</Button> : null}
        {data.nextCursor ? <Button variant="outline" disabled={isFetching} onClick={() => setCursors((rows) => [...rows, data.nextCursor!])}>{m.chart_next()}</Button> : null}
      </div>
    </> : null}
  </main>;
}
