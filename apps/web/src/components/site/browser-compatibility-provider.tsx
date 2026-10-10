"use client";

import * as React from "react";
import { MotionProvider } from "@astrodx/ui/motion";
import {
  getCompatibilitySnapshot,
  subscribeCompatibilityPreference,
  syncCompatibilityAttribute,
} from "@/lib/browser-compatibility-preference";

export function useSimpleCompatibility(): boolean {
  return React.useSyncExternalStore(subscribeCompatibilityPreference, getCompatibilitySnapshot, () => false);
}

export function BrowserCompatibilityProvider({ children }: { children: React.ReactNode }) {
  const simple = useSimpleCompatibility();
  React.useEffect(() => {
    // Document attributes can be reset when switching locale layout roots.
    syncCompatibilityAttribute();
  }, [simple]);
  return <MotionProvider forceReducedMotion={simple}>{children}</MotionProvider>;
}
