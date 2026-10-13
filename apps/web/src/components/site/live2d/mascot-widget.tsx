"use client";

/**
 * 看板娘 — one instance for the whole site, in one of two places:
 *
 * - dock: fixed to the bottom-right viewport edge, mirroring the old blog's
 *   live2d-widget (waifu) placement. 参考 autoload.js：窄屏彻底不初始化（引擎/
 *   模型都不加载），而非仅 CSS 隐藏。"Narrow" is the viewport, not the screen:
 *   a narrow window on a big monitor would otherwise get a 230×320 corner of
 *   its content covered. Touch-only devices are left out too — her toolbar
 *   and reactions need a hovering pointer. Dismissed (settings panel or her
 *   own goodbye button) or simple compatibility mode also means nothing is
 *   loaded. Stacked under the download dock (z-50) and the batch download bar
 *   (z-40): she is decoration and must never sit on top of a control.
 *
 * - stage: on the mascot page (/live2d) she takes the page's stage slot,
 *   whatever the corner rules say — that page is how everyone the corner
 *   leaves out gets to see her. Arriving from a page where she sat in the
 *   corner, the same instance moves up (no reload): the placement flips in the
 *   same commit as the route, and the page's view transition morphs her
 *   "live2d-mascot" group from the corner box to the stage box (globals.css).
 */
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import * as React from "react";
import { useSimpleCompatibility } from "@/components/site/browser-compatibility-provider";
import type { Locale } from "@/lib/i18n";
import { isMascotPagePath, mascotPlacement } from "@/lib/live2d/mascot-page";
import { useMascotStore } from "./mascot-store";
import { useMascotHidden } from "./use-mascot-hidden";

const Live2DMascot = dynamic(() => import("./live2d-mascot"), {
  ssr: false,
  loading: () => null,
});

const WIDE_POINTER_QUERY = "(min-width: 768px) and (hover: hover) and (pointer: fine)";

function subscribeWidePointer(onChange: () => void): () => void {
  const query = window.matchMedia(WIDE_POINTER_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Re-evaluated live: narrowing the window below 768px unloads her. */
function useWidePointer(): boolean {
  return React.useSyncExternalStore(
    subscribeWidePointer,
    () => window.matchMedia(WIDE_POINTER_QUERY).matches,
    () => false
  );
}

const noopSubscribe = () => () => {};

/** CSS anchor positioning places her on the stage with no script; older engines get measured instead. */
function useAnchorPositioning(): boolean {
  return React.useSyncExternalStore(
    noopSubscribe,
    () => typeof CSS !== "undefined" && CSS.supports("anchor-name: --live2d-stage"),
    () => true
  );
}

type Box = { top: number; left: number; width: number; height: number };

/**
 * Fallback for engines without anchor positioning: the stage slot's box in
 * document coordinates, kept up to date while the page's layout settles.
 */
function useMeasuredStage(enabled: boolean): Box | null {
  const slot = useMascotStore((state) => state.stage);
  const [box, setBox] = React.useState<Box | null>(null);
  React.useLayoutEffect(() => {
    if (!enabled || !slot) {
      setBox(null);
      return;
    }
    const measure = () => {
      const r = slot.getBoundingClientRect();
      setBox({ top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height });
    };
    measure();
    // The slot itself, and anything above it settling (fonts, a dismissed banner).
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    observer.observe(document.body);
    window.addEventListener("resize", measure, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [enabled, slot]);
  return box;
}

export function MascotWidget({ locale }: { locale: Locale }) {
  const pathname = usePathname() ?? "/";
  const hidden = useMascotHidden();
  const simple = useSimpleCompatibility();
  const wide = useWidePointer();
  const anchored = useAnchorPositioning();
  const placement = mascotPlacement({
    onMascotPage: isMascotPagePath(pathname),
    cornerAllowed: wide && !hidden && !simple,
  });
  const measured = useMeasuredStage(placement === "stage" && !anchored);
  if (!placement) return null;
  const onStage = placement === "stage";
  return (
    <div
      data-placement={placement}
      // Click-through: only her drawn pixels and the toolbar take the pointer
      // (see live2d-mascot.tsx), never the box around her. On the stage she
      // sits in the page (absolute, scrolling with it), under the sticky
      // header (z-20) and the phone tab bar (z-30).
      className={
        onStage
          ? "live2d-staged pointer-events-none absolute z-10"
          : "pointer-events-none fixed bottom-0 right-0 z-30 h-80 w-[230px]"
      }
      style={{
        // Own view-transition-name: pinned across ordinary navigations, and
        // morphed between the corner and the stage (see globals.css).
        viewTransitionName: "live2d-mascot",
        ...(onStage && !anchored && measured ? measured : null),
      }}
    >
      <Live2DMascot locale={locale} placement={placement} />
    </div>
  );
}
