import { Button } from "@astrodx/ui/components/button";
import { Link, useLocation } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
const valid = (value: unknown): value is string => typeof value === "string" && (value === "" || value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value));
export function SocialPager({ base, nextCursor, status }: { base: string; nextCursor: string | null; status?: string }) {
  const location = useLocation(), params = new URLSearchParams(location.search), current = params.get("cursor") ?? "";
  const scope = `${base}:${status ?? ""}`;
  const history: string[] = location.state?.socialPageScope === scope && Array.isArray(location.state?.socialCursors) ? location.state.socialCursors.slice(-100).filter(valid) : [];
  function href(cursor?: string) { const p = new URLSearchParams(); if (status) p.set("status", status); if (cursor) p.set("cursor", cursor); return localizeHref(base) + (p.size ? `?${p}` : ""); }
  return <nav aria-label={m.social_pagination()} className="flex flex-wrap gap-3">
    {current ? <Button asChild variant="outline"><Link to={href(history.at(-1))} state={{ socialPageScope: scope, socialCursors: history.slice(0, -1) }}>{m.chart_previous()}</Link></Button> : null}
    {nextCursor ? <Button asChild variant="outline"><Link to={href(nextCursor)} state={{ socialPageScope: scope, socialCursors: [...history, current] }}>{m.chart_next()}</Link></Button> : null}
  </nav>;
}
