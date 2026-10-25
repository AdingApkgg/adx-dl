import { useInView, useMotionPreference, useReducedMotion } from "@astrodx/ui/motion";
import { useSyncExternalStore, type RefObject } from "react";

/** The boot script can settle the preference before the Provider hydrates. */
export function motionBlocked(reduced: boolean) {
  if (typeof document === "undefined" || reduced) return true;
  const mode = document.documentElement.dataset.motion;
  if (mode === "off") return true;
  if (mode === "on") return false;
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

const visibilityListeners = new Set<() => void>();
const notifyVisibility = () => { for (const notify of visibilityListeners) notify(); };
function subscribeVisibility(notify: () => void) {
  if (!visibilityListeners.size) document.addEventListener("visibilitychange", notifyVisibility);
  visibilityListeners.add(notify);
  return () => {
    visibilityListeners.delete(notify);
    if (!visibilityListeners.size) document.removeEventListener("visibilitychange", notifyVisibility);
  };
}
const visible = () => document.visibilityState === "visible";
const serverFalse = () => false;
const FINE_POINTER = "(hover: hover) and (pointer: fine)";
function subscribePointer(notify: () => void) {
  const query = window.matchMedia?.(FINE_POINTER);
  query?.addEventListener("change", notify);
  return () => query?.removeEventListener("change", notify);
}
const finePointer = () => Boolean(window.matchMedia?.(FINE_POINTER).matches);

/** No motion-valued styles are attached until hydration and boot preference agree. */
export function useMotionEnabled() {
  const reduced = useReducedMotion();
  const { ready } = useMotionPreference();
  const foreground = useSyncExternalStore(subscribeVisibility, visible, serverFalse);
  // React preference is authoritative after sync. Reading data-motion here
  // would observe the previous mode because the Provider writes it in an effect.
  return ready && foreground && !reduced;
}

export function useFinePointer() {
  return useSyncExternalStore(subscribePointer, finePointer, serverFalse);
}

/** Infinite decoration only runs while the actual scene is visible. */
export function useMotionActivity(ref: RefObject<Element | null>) {
  const enabled = useMotionEnabled();
  const inView = useInView(ref, { amount: 0.05 });
  return enabled && inView;
}
