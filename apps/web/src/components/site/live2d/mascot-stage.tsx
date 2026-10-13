"use client";

import { CameraIcon, CheckIcon, QuoteIcon, RocketIcon, ShirtIcon, SparklesIcon, UsersIcon } from "lucide-react";
import * as React from "react";
import { choiceClass } from "@astrodx/ui/components/appearance-pickers";
import { cn } from "@astrodx/ui/lib/utils";
import type { Locale } from "@/lib/i18n";
import { setMascotHidden } from "@/lib/live2d/mascot-preference";
import { getLive2DCopy } from "./live2d-copy";
import { type MascotActions, setMascotStage, useMascotStore } from "./mascot-store";
import { useMascotHidden } from "./use-mascot-hidden";

/**
 * The box the mascot stands in on the mascot page. It renders no mascot
 * itself: the site-wide instance (mascot-widget.tsx) is positioned over it,
 * so arriving from a page where she sat in the corner moves her here instead
 * of loading a second copy. Same aspect ratio as the corner (230×320), so the
 * move is a pure scale.
 */
export function MascotStage({ locale }: { locale: Locale }) {
  const copy = getLive2DCopy(locale).page;
  const status = useMascotStore((state) => state.status);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    setMascotStage(ref.current);
    return () => setMascotStage(null);
  }, []);
  return (
    <div
      ref={ref}
      // mt-6: room for her speech bubble, which sits above her head.
      className="live2d-stage-slot relative mx-auto mt-6 aspect-[230/320] w-full max-w-[21.5625rem] rounded-3xl border border-border/60 bg-linear-to-b from-primary/5 to-primary/15"
    >
      {status === "ready" ? null : (
        <p
          className={cn(
            "absolute inset-x-4 bottom-6 text-center text-sm",
            status === "failed" ? "text-destructive" : "animate-pulse text-muted-foreground"
          )}
        >
          {status === "failed" ? copy.failed : copy.loading}
        </p>
      )}
    </div>
  );
}

const FINE_POINTER_QUERY = "(pointer: fine)";

function subscribeFinePointer(onChange: () => void): () => void {
  const query = window.matchMedia(FINE_POINTER_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** The asteroids game is played with arrow keys and space: nothing to do with it on a touch screen. */
function useFinePointer(): boolean {
  return React.useSyncExternalStore(
    subscribeFinePointer,
    () => window.matchMedia(FINE_POINTER_QUERY).matches,
    () => false
  );
}

/** Labelled versions of the corner's hover toolbar, usable by touch. */
export function MascotControls({ locale }: { locale: Locale }) {
  const copy = getLive2DCopy(locale);
  const ready = useMascotStore((state) => state.status === "ready");
  const actions = useMascotStore((state) => state.actions);
  const finePointer = useFinePointer();
  const items: { key: keyof MascotActions; icon: React.ReactNode; label: string }[] = [
    { key: "hitokoto", icon: <QuoteIcon />, label: copy.tools.hitokoto },
    { key: "switchTexture", icon: <ShirtIcon />, label: copy.tools.switchTexture },
    { key: "switchModel", icon: <UsersIcon />, label: copy.tools.switchModel },
    { key: "photo", icon: <CameraIcon />, label: copy.tools.photo },
    ...(finePointer ? [{ key: "asteroids" as const, icon: <RocketIcon />, label: copy.tools.asteroids }] : []),
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          disabled={!ready || !actions}
          onClick={() => actions?.[item.key]()}
          className={cn(choiceClass(false), "min-h-11 disabled:pointer-events-none disabled:opacity-50")}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Show or hide her in the corner of the other pages; also used by the settings panel. */
export function MascotCornerToggle({ locale }: { locale: Locale }) {
  const copy = getLive2DCopy(locale).settings;
  const enabled = !useMascotHidden();
  return (
    <div className="grid grid-cols-2 gap-2">
      {([true, false] as const).map((value) => {
        const active = enabled === value;
        return (
          <button
            key={String(value)}
            type="button"
            aria-pressed={active}
            onClick={() => setMascotHidden(!value)}
            className={choiceClass(active)}
          >
            <SparklesIcon aria-hidden="true" className={value ? undefined : "opacity-50"} />
            <span>{value ? copy.enable : copy.disable}</span>
            {active ? <CheckIcon aria-hidden="true" className="ml-auto size-3.5" /> : null}
          </button>
        );
      })}
    </div>
  );
}
