"use client";

import { useSyncExternalStore } from "react";
import { ArrowUpToLineIcon } from "lucide-react";

import { usePathLocale } from "@/app/use-path-locale";
import { useDownloadsStore } from "@/components/site/downloads/downloads-store";
import { getDictionary, type Locale } from "@/lib/i18n";

function subscribeToScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  window.addEventListener("pageshow", onChange);
  return () => {
    window.removeEventListener("scroll", onChange);
    window.removeEventListener("pageshow", onChange);
  };
}

const isPastTop = () => window.scrollY >= 320;
const isPastTopOnServer = () => false;

export function BackToTop({
  locale: initialLocale,
  deriveLocaleFromPath,
}: {
  locale: Locale;
  deriveLocaleFromPath: boolean;
}) {
  const locale = usePathLocale(initialLocale, deriveLocaleFromPath);
  const visible = useSyncExternalStore(subscribeToScroll, isPastTop, isPastTopOnServer);
  const hasBatchBar = useDownloadsStore((state) => state.bottomBars > 0);

  if (!visible) return null;

  const label = getDictionary(locale).nav.backToTop;
  return (
    <button
      type="button"
      data-back-to-top
      data-batch-bar={hasBatchBar ? "" : undefined}
      aria-label={label}
      title={label}
      onClick={(event) => {
        if (event.detail === 0) {
          document.getElementById("skip-to-main-content")?.focus({ preventScroll: true });
        }
        window.scrollTo({ top: 0, behavior: "instant" });
      }}
      className="fixed right-[max(1rem,env(safe-area-inset-right))] z-40 flex size-11 items-center justify-center rounded-full border border-border bg-popover text-popover-foreground shadow-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <ArrowUpToLineIcon className="size-[18px]" aria-hidden="true" />
    </button>
  );
}
