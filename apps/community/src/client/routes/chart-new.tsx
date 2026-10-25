import { AuthorNavigation } from "../components/author-navigation";
import { LoadingState } from "../components/ui-states";
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
  if (!me) return me === undefined ? <LoadingState label={m.ui_route_loading()} /> : null;
  return <main className="community-author-page space-y-6">
    <AuthorNavigation view="new" />
    <PageTitle description={m.charts_private_hint()}>{m.chart_new()}</PageTitle>
    <section className="community-panel space-y-3" aria-label={m.ui_author_steps_title()}><h2 className="community-section-title">{m.ui_author_steps_title()}</h2><ol className="community-author-steps"><li>{m.ui_author_step_import()}</li><li>{m.ui_author_step_save()}</li><li>{m.ui_author_step_publish()}</li></ol><p className="text-sm leading-7 text-muted-foreground">{m.ui_author_steps_hint()}</p></section>
    <ChartUpload userId={me.id} onSaved={async (chart, operation) => {
      await operation.assertActive();
      await navigate(localizeHref(`/me/charts/${chart.id}`));
    }} />
    <Link to={localizeHref("/me/charts")} className={textLinkClass}>{m.charts_title()}</Link>
  </main>;
}
