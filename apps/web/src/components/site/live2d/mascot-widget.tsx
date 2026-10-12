"use client";

/**
 * 右下角看板娘 — fixed to the bottom-right viewport edge site-wide, mirroring
 * the old blog's live2d-widget (waifu) placement.
 * 参考 autoload.js：<768px 彻底不初始化（引擎/模型都不加载），而非仅 CSS 隐藏。
 * Dismissed (settings panel or her own goodbye button) or simple compatibility
 * mode also means nothing is loaded.
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

export function MascotWidget({ locale }: { locale: Locale }) {
  const hidden = useMascotHidden();
  const simple = useSimpleCompatibility();
  const [wide, setWide] = React.useState(false);
  React.useEffect(() => {
    setWide(window.screen.width >= 768);
  }, []);
  if (!wide || hidden || simple) return null;
  return (
    <div
      className="fixed bottom-0 right-0 z-30"
      // Own view-transition-name = pinned during page transitions (see
      // globals.css) instead of blinking with the root snapshot.
      style={{ viewTransitionName: "live2d-mascot" }}
    >
      <Live2DMascot locale={locale} width={230} height={320} />
    </div>
  );
}
