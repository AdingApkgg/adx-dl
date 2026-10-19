import { dehydrate, HydrationBoundary, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import { queryClientContext } from "@/shared/router-context";
import { ChartUpload } from "../components/chart-upload";
import { PageTitle, textLinkClass } from "../components/page-title";
import { getRenderApi } from "../lib/browser";
import { requireUser } from "../lib/require-user";
import { meQuery } from "../queries/me";
import type { Route } from "./+types/chart-new";
export async function loader({ context, url }: Route.LoaderArgs) {
  await requireUser(context, url);
  return { dehydratedState: dehydrate(context.get(queryClientContext)) };
}
export function meta() { return [{ title: `${m.chart_new()} - ${m.site_name()}` }, { name: "robots", content: "noindex" }]; }
export default function ChartNew({ loaderData }: Route.ComponentProps) {
  return <HydrationBoundary state={loaderData.dehydratedState}><NewChart /></HydrationBoundary>;
}
function NewChart() {
  const { data: me } = useQuery(meQuery(getRenderApi()));
  const navigate = useNavigate();
  if (!me) return null;
  return <main className="space-y-6">
    <PageTitle description={m.charts_private_hint()}>{m.chart_new()}</PageTitle>
    <ChartUpload userId={me.id} onSaved={async (chart, operation) => {
      await operation.assertActive();
      await navigate(localizeHref(`/me/charts/${chart.id}`));
    }} />
    <Link to={localizeHref("/me/charts")} className={textLinkClass}>{m.charts_title()}</Link>
  </main>;
}
