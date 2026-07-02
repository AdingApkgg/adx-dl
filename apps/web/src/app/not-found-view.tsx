"use client";

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  buildLocalePath,
  getDictionary,
  isSupportedLocale,
  type Locale,
} from "@/lib/i18n";

/**
 * Shared 404 content. On GitHub Pages the exported 404.html is one static page
 * served for every unmatched URL (including /en/... and /ja/...), so the locale
 * can only be derived client-side from the real location. The zh SSR markup is
 * kept for the first paint and re-rendered after mount to avoid a hydration
 * mismatch.
 */
export function NotFoundView() {
  const [locale, setLocale] = React.useState<Locale>("zh");

  React.useEffect(() => {
    const [firstSegment] = window.location.pathname.split("/").filter(Boolean);
    if (firstSegment && isSupportedLocale(firstSegment)) {
      // Intentional one-time sync from the URL (an external system) after
      // mount — the static 404.html is one page for all locales, so the SSR
      // markup must stay zh and re-render only on the client.
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setLocale(firstSegment);
    }
  }, []);

  const notFound = getDictionary(locale).notFound;

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center"
    >
      <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">
        404
      </p>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {notFound.title}
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">{notFound.description}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link href={buildLocalePath("/", locale)}>{notFound.backHome}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={buildLocalePath("/charts", locale)}>{notFound.browseCharts}</Link>
        </Button>
      </div>
    </main>
  );
}
