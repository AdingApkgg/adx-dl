import { useSyncExternalStore } from "react";
import { ArrowUpToLineIcon } from "lucide-react";
import { m } from "@/paraglide/messages.js";

function subscribeToScroll(callback: () => void) {
  window.addEventListener("scroll", callback, { passive: true });
  window.addEventListener("pageshow", callback);
  return () => {
    window.removeEventListener("scroll", callback);
    window.removeEventListener("pageshow", callback);
  };
}

export function BackToTop() {
  const visible = useSyncExternalStore(subscribeToScroll, () => window.scrollY >= 320, () => false);
  if (!visible) return null;

  const label = m.ui_back_to_top();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="community-back-to-top fixed z-30 flex size-11 items-center justify-center rounded-full border border-border bg-popover text-popover-foreground shadow-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      onClick={(event) => {
        if (event.detail === 0) document.getElementById("community-skip-link")?.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: "instant" });
      }}
    >
      <ArrowUpToLineIcon className="size-[18px]" aria-hidden="true" />
    </button>
  );
}
