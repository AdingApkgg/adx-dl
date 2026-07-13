import * as React from "react";

// React's <ViewTransition> only exists in the canary build Next vendors for
// the App Router (activated by `experimental.viewTransition`). The stable
// react package bun's test runner resolves does not export it, so grab it
// dynamically and fall through to plain children when it's absent.
const ViewTransition = (React as Record<string, unknown>).ViewTransition as
  | React.ComponentType<{
      update?: string;
      default?: string;
      children: React.ReactNode;
    }>
  | undefined;

/**
 * Animates page content across client-side navigations. On navigation React
 * snapshots the old/new content and runs the browser View Transition tagged
 * with the `vt-page` class — globals.css maps it onto the same vt-page-in/out
 * keyframes that already animate hard (cross-document) loads, so both kinds
 * of navigation share one branded motion. The site header sits outside this
 * wrapper and carries view-transition-name: site-header, so the chrome stays
 * pinned while content travels.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  if (!ViewTransition) {
    return <>{children}</>;
  }
  return (
    <ViewTransition update="vt-page" default="none">
      {children}
    </ViewTransition>
  );
}
