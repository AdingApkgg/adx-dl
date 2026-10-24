import { MotionGroup, MotionSurface } from "../components/motion-ui";
import { Alert } from "@astrodx/ui/components/alert";
import { Button } from "@astrodx/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useRevalidator } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import type { FavoriteItem } from "@/shared/community-social";
import { PageTitle } from "../components/page-title";
import { ErrorCard } from "../components/error-card";
import { PublicChartCard } from "../components/public-chart-card";
import { SocialPager } from "../components/social-pager";
import { LibraryNavigation } from "../components/library-ui";
import { accountErrorRedirect } from "../lib/account-errors";
import { getRenderApi } from "../lib/browser";
import { loadSocial, socialError } from "../lib/community-social";
import { socialApi } from "../queries/community-social";
import { meQuery } from "../queries/me";
import type { Route } from "./+types/favorites";
export { headers, shouldRevalidate } from "../lib/community-social";
export async function loader({ context, url }: Route.LoaderArgs) { return loadSocial(context, url, api => api.favorites(url.searchParams.get("cursor") ?? undefined)); }
export function meta() { return [{ title: `${m.my_favorites()} - ${m.site_name()}` }, { name: "robots", content: "noindex, nofollow" }]; }
export default function Favorites({ loaderData }: Route.ComponentProps) {
  const { data: me } = useQuery(meQuery(getRenderApi()));
  if (me === null || me && (me.id !== loaderData.userId || me.status !== "active")) return null;
  return <main className="space-y-6"><header className="community-page-heading"><PageTitle description={m.favorites_private()}>{m.my_favorites()}</PageTitle><Button asChild variant="outline" className="min-h-11"><Link to={localizeHref("/charts")}>{m.public_charts_title()}</Link></Button></header>
    <LibraryNavigation view="favorites" />
    <section aria-label={m.my_favorites()} className="space-y-4"><div className="community-section-heading"><h2 className="community-section-title">{m.my_favorites()}</h2><p className="text-xs text-muted-foreground">{m.ui_library_page_count({ count: String(loaderData.page.items.length) })}</p></div>
    {loaderData.page.items.length ? <MotionGroup as="ul" className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">{loaderData.page.items.map(item => <li key={`${loaderData.userId}/${item.publicId}`} className="min-w-0"><FavoriteRow item={item} /></li>)}</MotionGroup> : <div className="community-empty space-y-3"><p className="font-medium text-foreground">{m.favorites_empty()}</p><p>{m.ui_library_favorites_empty_hint()}</p><Button asChild variant="outline" className="min-h-11"><Link to={localizeHref("/charts")}>{m.public_charts_title()}</Link></Button></div>}
    </section>
    <SocialPager base="/me/favorites" nextCursor={loaderData.page.nextCursor} />
  </main>;
}
function FavoriteRow({ item }: { item: FavoriteItem }) {
  const [pending, setPending] = useState(false), [failure, setFailure] = useState<string | null>(null);
  const location = useLocation(), revalidator = useRevalidator(), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function remove() {
    setPending(true); setFailure(null);
    try { const saved = await socialApi(getRenderApi()).removeFavorite(item.publicId); if (!alive.current) return;
      if (saved.favorited) throw new Error("Unconfirmed");
      await revalidator.revalidate();
    } catch (error) { if (alive.current) { const target = accountErrorRedirect(error, location.pathname + location.search); if (target) window.location.assign(target); else setFailure(socialError(error)); } }
    finally { if (alive.current) setPending(false); }
  }
  return <MotionSurface as="article" hover className="flex h-full flex-col gap-3 rounded-xl border p-3">
    {item.chart ? <PublicChartCard chart={item.chart} /> : <div className="space-y-2 rounded-lg bg-muted p-4"><h2 className="font-semibold">{m.social_chart_number({ id: item.publicId })}</h2><p className="text-sm text-muted-foreground">{m.favorite_unavailable()}</p></div>}
    <Button type="button" variant="outline" className="mt-auto min-h-11" disabled={pending} onClick={() => void remove()}>{pending ? m.dash_submitting() : m.favorite_remove()}</Button>
    {failure ? <Alert variant="destructive">{failure}</Alert> : null}
  </MotionSurface>;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { return <ErrorCard error={error} />; }
