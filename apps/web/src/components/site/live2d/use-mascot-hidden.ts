"use client";

import * as React from "react";
import {
  getMascotHiddenSnapshot,
  subscribeMascotHidden,
} from "@/lib/live2d/mascot-preference";

export function useMascotHidden(): boolean {
  return React.useSyncExternalStore(subscribeMascotHidden, getMascotHiddenSnapshot, () => false);
}
