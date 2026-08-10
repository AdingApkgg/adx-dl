"use client";

import "./globals.css";

import * as React from "react";

import { getDictionary, isSupportedLocale, type Locale } from "@/lib/i18n";

/**
 * Last-resort boundary: it replaces the root layout, so neither the html/body
 * shells from the route groups nor the theme/motion providers exist here. Every
 * dependency is therefore inlined — plain elements, no framer-motion, and an
 * explicit `globals.css` import (the root layout that normally pulls it in has
 * been swapped out). Only a crash in a layout itself reaches this far; page
 * crashes are caught by the per-tree `error.tsx`.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [locale, setLocale] = React.useState<Locale>("zh");

  React.useEffect(() => {
    const [firstSegment] = window.location.pathname.split("/").filter(Boolean);
    if (firstSegment && isSupportedLocale(firstSegment)) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setLocale(firstSegment);
    }
  }, []);

  const copy = getDictionary(locale).errorPage;
  const lang = locale === "zh" ? "zh-CN" : locale;

  return (
    <html lang={lang} className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground">
        <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-4 px-4 py-24 text-center">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{copy.title}</h1>
          <p className="max-w-md text-sm text-muted-foreground">{copy.description}</p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {copy.retry}
            </button>
            <a
              href={locale === "zh" ? "/" : `/${locale}`}
              className="inline-flex h-9 items-center justify-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              {copy.backHome}
            </a>
          </div>
          {error.digest ? (
            <p className="mt-2 font-mono text-xs text-muted-foreground/70">
              {copy.detailsLabel}: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
