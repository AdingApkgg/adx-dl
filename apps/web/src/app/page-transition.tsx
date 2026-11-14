"use client";

import { usePathname } from "next/navigation";
import * as React from "react";

// React's <ViewTransition> only exists in the canary build Next vendors for
// the App Router (enabled without configuration in Next 16.3). The stable
// react package bun's test runner resolves does not export it, so grab it
// dynamically and fall through to plain children when it's absent.
const ViewTransition = (React as Record<string, unknown>).ViewTransition as
  | React.ComponentType<{
      update?: string;
      enter?: string;
      exit?: string;
      default?: string;
      children: React.ReactNode;
    }>
  | undefined;

/** Only pathname changes replace the boundary; deferred filters stay local. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (!ViewTransition) {
    return <>{children}</>;
  }
  return (
    <ViewTransition key={pathname} enter="vt-page" exit="vt-page" update="none" default="none">
      {children}
    </ViewTransition>
  );
}
