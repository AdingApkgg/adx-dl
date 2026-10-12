"use client";

import { MegaphoneIcon, WifiOffIcon, XIcon } from "lucide-react";
import Link from "next/link";

import { AnimatePresence, EASE_OUT, motion, useReducedMotion } from "@astrodx/ui/motion";
import { useConnectionBanner } from "@/components/site/banners/use-connection-banner";
import {
  storePreferredLocale,
  useLocaleSuggestion,
} from "@/components/site/banners/use-locale-suggestion";
import { useBannerNotice } from "@/components/site/banners/use-banner-notice";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { resolveText } from "@/lib/notices";
import { pickBanner } from "@/lib/site-banners";

const BAR = "flex items-center justify-center gap-2 border-b border-border/60 px-4 py-1.5";

/**
 * The single top-of-page bar slot.
 *
 * Three independent facts compete for it (connectivity, an urgent or featured notice, a
 * language suggestion); `pickBanner` decides which one wins. One always-mounted
 * live region wraps them all so a transition is announced, and `polite` is
 * deliberate even for urgent notices: `assertive` interrupts whatever sentence
 * a screen reader is in the middle of, which no site notice is worth.
 */
export function SiteBanners({ locale }: { locale: Locale }) {
  const connection = useConnectionBanner();
  const bannerNotice = useBannerNotice();
  const suggestion = useLocaleSuggestion(locale === "zh");
  const prefersReducedMotion = useReducedMotion();
  const dictionary = getDictionary(locale);
  const suggestionDictionary = suggestion ? getDictionary(suggestion.target).localeBanner : null;

  const kind = pickBanner({
    connection: connection !== null,
    notice: bannerNotice !== null,
    locale: suggestion !== null,
  });

  return (
    <div aria-live="polite" role="status">
      <AnimatePresence mode="wait">
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

            {kind === "notice" && bannerNotice ? (
              <div
                className={
                  bannerNotice.notice.level === "urgent"
                    ? `${BAR} bg-destructive/10 text-sm text-destructive-strong`
                    : `${BAR} bg-primary/10 text-sm`
                }
              >
                {bannerNotice.notice.level === "urgent" ? null : (
                  <MegaphoneIcon aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
                )}
                <span className="font-medium">
                  {resolveText(bannerNotice.notice.title, locale).value}
                </span>
                <Link
                  href={`${buildLocalePath("/notices", locale)}#${bannerNotice.notice.id}`}
                  className="underline underline-offset-4"
                >
                  {dictionary.notices.detail}
                </Link>
                <button
                  type="button"
                  aria-label={dictionary.notices.dismiss}
                  className="rounded-sm p-1 transition-colors hover:text-foreground"
                  onClick={bannerNotice.dismiss}
                >
                  <XIcon className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : null}

            {kind === "locale" && suggestion && suggestionDictionary ? (
              <div className={`${BAR} bg-primary/10 text-sm`}>
                <Link
                  href={suggestion.href}
                  lang={suggestion.target}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => storePreferredLocale(suggestion.target)}
                >
                  {suggestionDictionary.continueIn}
                </Link>
                <button
                  type="button"
                  aria-label={suggestionDictionary.dismiss}
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
