"use client";

/**
 * 右下角看板娘 — fixed to the bottom-right viewport edge site-wide, mirroring
 * the old blog's live2d-widget (waifu) placement.
 * 参考 autoload.js：窄屏彻底不初始化（引擎/模型都不加载），而非仅 CSS 隐藏。
 * "Narrow" is the viewport, not the screen: a narrow window on a big monitor
 * would otherwise get a 230×320 corner of its content covered. Touch-only
 * devices are left out too — her toolbar and reactions need a hovering
 * pointer. Dismissed (settings panel or her own goodbye button) or simple
 * compatibility mode also means nothing is loaded.
 *
 * Stacked under the download dock (z-50) and the batch download bar (z-40):
 * she is decoration and must never sit on top of a control.
 */
import dynamic from "next/dynamic";
import * as React from "react";
import { useSimpleCompatibility } from "@/components/site/browser-compatibility-provider";
import type { Locale } from "@/lib/i18n";
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

export function MascotWidget({ locale }: { locale: Locale }) {
  const hidden = useMascotHidden();
  const simple = useSimpleCompatibility();
  const wide = useWidePointer();
  if (!wide || hidden || simple) return null;
  return (
    <div
      // Click-through: only her drawn pixels and the toolbar take the pointer
      // (see live2d-mascot.tsx), never the 230×320 box around her.
      className="pointer-events-none fixed bottom-0 right-0 z-30"
      // Own view-transition-name = pinned during page transitions (see
      // globals.css) instead of blinking with the root snapshot.
      style={{ viewTransitionName: "live2d-mascot" }}
    >
      <Live2DMascot locale={locale} width={230} height={320} />
    </div>
  );
}
