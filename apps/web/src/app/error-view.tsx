"use client";

import Link from "next/link";
import * as React from "react";

import { RevealItem } from "@/components/motion";
import { Button } from "@/components/ui/button";
import {
  buildLocalePath,
  getDictionary,
  isSupportedLocale,
  type Locale,
} from "@/lib/i18n";

/**
 * A chunk that 404s after a deploy is the single most likely runtime error on a
 * static export: the service worker activates a new build, the old hashed
 * `_next/static` chunks are swept, and a long-lived tab that lazy-loads anything
 * afterwards throws. That failure is fully self-healing with one reload, so the
 * boundary does it automatically instead of showing the user a dead end. The
 * sessionStorage flag makes it strictly one attempt per tab — a genuinely broken
 * deploy must surface the error screen rather than reload-loop.
 */
const RELOAD_FLAG = "astrodx-chunk-reload";

export function isChunkLoadError(error: Error): boolean {
  return (
    error.name === "ChunkLoadError" ||
    /Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(
      error.message
    )
  );
}

export type ErrorViewProps = Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
  /**
   * Known at build time for the `[locale]` tree. The `(default)` tree and the
   * root boundary pass nothing and let the pathname decide, which also covers
   * the exported 404/500 shells that serve every locale from one document.
   */
  locale?: Locale;
}>;

export function ErrorView({ error, reset, locale: fixedLocale }: ErrorViewProps) {
  const [locale, setLocale] = React.useState<Locale>(fixedLocale ?? "zh");

  React.useEffect(() => {
    if (fixedLocale) return;
    const [firstSegment] = window.location.pathname.split("/").filter(Boolean);
    if (firstSegment && isSupportedLocale(firstSegment)) {
      // One-time sync from the URL (an external system) after mount, matching
      // NotFoundView: the SSR markup must stay zh so hydration lines up.
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setLocale(firstSegment);
    }
  }, [fixedLocale]);

  React.useEffect(() => {
    if (!isChunkLoadError(error)) return;
    try {
      if (sessionStorage.getItem(RELOAD_FLAG)) return;
      sessionStorage.setItem(RELOAD_FLAG, "1");
    } catch {
      // Private mode / storage disabled: skip the auto-reload rather than risk
      // a loop we cannot bound.
      return;
    }
    window.location.reload();
  }, [error]);

  React.useEffect(() => {
    // A render that succeeds clears the budget so a later, unrelated chunk
    // failure still gets its one free reload.
    try {
      sessionStorage.removeItem(RELOAD_FLAG);
    } catch {
      // Ignore — the flag is an optimisation, not a correctness requirement.
    }
  }, []);

  const copy = getDictionary(locale).errorPage;

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center"
    >
      <p aria-hidden="true" className="select-none text-6xl font-bold tracking-tight sm:text-7xl">
        <span className="text-primary">!</span>
      </p>
      <RevealItem delay={0.1}>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{copy.title}</h1>
      </RevealItem>
      <RevealItem delay={0.2}>
        <p className="max-w-md text-sm text-muted-foreground">{copy.description}</p>
      </RevealItem>
      <RevealItem delay={0.3} className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset}>{copy.retry}</Button>
        <Button variant="outline" asChild>
          <Link href={buildLocalePath("/", locale)}>{copy.backHome}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={buildLocalePath("/charts", locale)}>{copy.browseCharts}</Link>
        </Button>
      </RevealItem>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-muted-foreground/70">
          {copy.detailsLabel}: {error.digest}
        </p>
      ) : null}
    </main>
  );
}
