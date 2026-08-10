"use client";

import * as React from "react";
import { ChevronRightIcon } from "lucide-react";

import styles from "@/components/site/home-page.module.css";
import { cn } from "@/lib/utils";

export type HomeFaqItem = { id: string; q: string; a: string };

/**
 * The home FAQ list, with real fragment targets.
 *
 * `<details>` does not open itself when the fragment names the element (the
 * browser's auto-expand only covers content *inside* a details), so the open
 * state is managed here: the first question is open by default — the hero's
 * "what is AstroDX?" shortcut used to scroll to the bottom of the page and show
 * five collapsed rows — and a matching `#fragment` opens (and highlights) its
 * own question instead, on load and on later hash changes.
 *
 * The answers stay in the markup either way, so the static HTML a crawler sees
 * is unchanged by which one happens to be expanded.
 */
export function HomeFaq({ items }: { items: readonly HomeFaqItem[] }) {
  const [openId, setOpenId] = React.useState<string | null>(items[0]?.id ?? null);

  React.useEffect(() => {
    const applyHash = () => {
      const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (!hash) return;
      if (items.some((item) => item.id === hash)) {
        setOpenId(hash);
      }
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [items]);

  return (
    <div className={styles.faqList}>
      {items.map((item) => (
        <details
          key={item.id}
          id={item.id}
          className={cn(styles.faqItem, "scroll-mt-24")}
          open={openId === item.id}
          // Controlled `open` alone would make the native toggle bounce back on
          // the next render; mirroring the browser's own toggle keeps the
          // disclosure behaving natively while the deep link still wins.
          onToggle={(event) => {
            const isOpen = event.currentTarget.open;
            setOpenId((current) =>
              isOpen ? item.id : current === item.id ? null : current
            );
          }}
        >
          <summary className={styles.faqSummary}>
            <span>{item.q}</span>
            <ChevronRightIcon className="size-4" aria-hidden="true" />
          </summary>
          <p className={styles.faqAnswer}>{item.a}</p>
        </details>
      ))}
    </div>
  );
}
