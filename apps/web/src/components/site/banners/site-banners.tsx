"use client";

import { WifiOffIcon, XIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { AnimatePresence, EASE_OUT, motion, useReducedMotion } from "@/components/motion";
import { useConnectionBanner } from "@/components/site/banners/use-connection-banner";
import {
  storePreferredLocale,
  useLocaleSuggestion,
} from "@/components/site/banners/use-locale-suggestion";
import { useUrgentNotice } from "@/components/site/banners/use-urgent-notice";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { resolveText } from "@/lib/notices";
import { pickBanner } from "@/lib/site-banners";

const BAR = "flex items-center justify-center gap-2 border-b border-border/60 px-4 py-1.5 text-sm";

/**
 * The single top-of-page bar slot.
 *
 * Three independent facts compete for it (connectivity, an urgent notice, a
 * language suggestion); `pickBanner` decides which one wins. One always-mounted
 * live region wraps them all so a transition is announced, and `polite` is
 * deliberate even for urgent notices: `assertive` interrupts whatever sentence
 * a screen reader is in the middle of, which no site notice is worth.
 */
export function SiteBanners({ locale }: { locale: Locale }) {
  const connection = useConnectionBanner();
  const urgent = useUrgentNotice();
  const suggestion = useLocaleSuggestion(locale === "zh");
  const prefersReducedMotion = useReducedMotion();
  const dictionary = getDictionary(locale);

  const kind = pickBanner({
    connection: connection !== null,
    notice: urgent !== null,
    locale: suggestion !== null,
  });

  return (
    <div aria-live="polite" role="status">
      <AnimatePresence>
        {kind ? (
          <motion.div
            key={kind}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            // MotionConfig doesn't gate height tweens — zero it out by hand.
            transition={{ duration: prefersReducedMotion ? 0 : 0.3, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            {kind === "connection" && connection === "offline" ? (
              <p className={`${BAR} bg-amber-500/15 text-center text-xs font-medium text-amber-900 dark:text-amber-200`}>
                <WifiOffIcon aria-hidden="true" className="size-3.5 shrink-0" />
                {dictionary.connection.offline}
              </p>
            ) : null}

            {kind === "connection" && connection === "restored" ? (
              <p className={`${BAR} bg-emerald-500/15 text-center text-xs font-medium text-emerald-900 dark:text-emerald-200`}>
                {dictionary.connection.restored}
              </p>
            ) : null}

            {kind === "notice" && urgent ? (
              <div className={`${BAR} bg-destructive/10 text-destructive`}>
                <span className="font-medium">
                  {resolveText(urgent.notice.title, locale).value}
                </span>
                <Link
                  href={`${buildLocalePath("/notices", locale)}#${urgent.notice.id}`}
                  className="underline underline-offset-4"
                >
                  {dictionary.notices.detail}
                </Link>
                <button
                  type="button"
                  aria-label={dictionary.notices.dismiss}
                  className="rounded-sm p-1 transition-colors hover:text-foreground"
                  onClick={urgent.dismiss}
                >
                  <XIcon className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : null}

            {kind === "locale" && suggestion ? (
              <div className={`${BAR} bg-primary/10`}>
                <Link
                  href={suggestion.href}
                  lang={suggestion.target}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => storePreferredLocale(suggestion.target)}
                >
                  {getDictionary(suggestion.target).localeBanner.continueIn}
                </Link>
                <button
                  type="button"
                  aria-label={getDictionary(suggestion.target).localeBanner.dismiss}
                  className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={suggestion.dismiss}
                >
                  <XIcon className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
