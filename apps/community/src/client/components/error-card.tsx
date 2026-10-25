import { Button } from "@astrodx/ui/components/button";
import { CompassIcon, CircleAlertIcon } from "lucide-react";
import { useId } from "react";
import { Link, isRouteErrorResponse, useRevalidator, useRouteLoaderData } from "react-router";
import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";
import type { loader as rootLoader } from "../root";

/** A recovery destination is useful even when the current route cannot be rendered. */
export function ErrorCard({ error }: { error: unknown }) {
  const requestId = useRouteLoaderData<typeof rootLoader>("root")?.requestId;
  const revalidator = useRevalidator(), heading = useId();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const Icon = notFound ? CompassIcon : CircleAlertIcon;
  return <main className="community-recovery space-y-6" aria-labelledby={heading}>
    <span aria-hidden="true" className="community-state-icon"><Icon /></span>
    <div className="space-y-3"><h1 id={heading} className="text-balance text-2xl font-bold tracking-tight">{notFound ? m.error_not_found_title() : m.error_server_title()}</h1>
      <p className="text-pretty text-sm leading-7 text-muted-foreground">{notFound ? m.error_not_found_body() : m.error_server_body()}</p></div>
    {!notFound && requestId ? <p className="rounded-lg border bg-muted/30 p-3 text-xs leading-6 text-muted-foreground">{m.error_request_id()}: <code className="font-mono">{requestId}</code></p> : null}
    <div className="community-toolbar">
      {!notFound ? <Button type="button" className="min-h-11" aria-busy={revalidator.state === "loading"} disabled={revalidator.state === "loading"} onClick={() => revalidator.revalidate()}>{m.error_retry()}</Button> : null}
      <Button asChild variant={notFound ? "default" : "outline"} className="min-h-11"><Link to={localizeHref("/charts")}>{m.public_charts_title()}</Link></Button>
      <Button asChild variant="outline" className="min-h-11"><a href={localizeHref("/")}>{m.error_home()}</a></Button>
    </div>
  </main>;
}
