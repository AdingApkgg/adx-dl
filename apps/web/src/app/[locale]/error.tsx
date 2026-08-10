"use client";

import { ErrorView } from "@/app/error-view";

/**
 * Client-side error boundary for the en/ja trees. The locale is left to
 * ErrorView's pathname sniffing rather than `useParams()`: one exported
 * boundary serves both prefixes, and the pathname is authoritative either way.
 */
export default function LocaleTreeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorView error={error} reset={reset} />;
}
