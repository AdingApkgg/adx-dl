"use client";

import { ErrorView } from "@/app/error-view";

/**
 * Client-side error boundary for the zh (unprefixed) tree. Next renders it in
 * place of the page subtree, inside the layout — so the header, footer and the
 * global download/music docks all survive the crash.
 */
export default function DefaultTreeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorView error={error} reset={reset} locale="zh" />;
}
