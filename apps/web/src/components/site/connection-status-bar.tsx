"use client";

import { WifiOffIcon } from "lucide-react";
import * as React from "react";

import { getDictionary, type Locale } from "@/lib/i18n";
import { useOnlineStatus } from "@/lib/use-online-status";

/** How long the "back online" confirmation stays up before fading out. */
const RESTORED_MS = 3000;

/**
 * A thin site-wide connectivity bar.
 *
 * Before this, only the downloads subsystem knew about `navigator.onLine`, so a
 * visitor who lost signal saw the random button do nothing and search results
 * silently stop arriving with no explanation anywhere on the page. The bar is
 * the explanation; individual features still handle their own failures.
 *
 * The "back online" state is shown briefly rather than permanently so the bar
 * confirms recovery and then gets out of the way.
 */
export function ConnectionStatusBar({ locale }: { locale: Locale }) {
  const online = useOnlineStatus();
  const [showRestored, setShowRestored] = React.useState(false);
  const [previousOnline, setPreviousOnline] = React.useState(online);

  // Adjusting state during render (rather than in an effect) is React's
  // documented pattern for reacting to a changed input: going offline clears
  // any lingering confirmation, and coming back from offline arms one.
  if (previousOnline !== online) {
    setPreviousOnline(online);
    setShowRestored(online && !previousOnline);
  }

  React.useEffect(() => {
    if (!showRestored) return;
    const timer = setTimeout(() => setShowRestored(false), RESTORED_MS);
    return () => clearTimeout(timer);
  }, [showRestored]);

  const copy = getDictionary(locale).connection;

  // The live region is always mounted so screen readers announce the
  // transition; only the visible bar comes and goes.
  return (
    <div aria-live="polite" role="status">
      {!online ? (
        <p className="flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-1.5 text-center text-xs font-medium text-amber-900 dark:text-amber-200">
          <WifiOffIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {copy.offline}
        </p>
      ) : showRestored ? (
        <p className="bg-emerald-500/15 px-4 py-1.5 text-center text-xs font-medium text-emerald-900 dark:text-emerald-200">
          {copy.restored}
        </p>
      ) : null}
    </div>
  );
}
