import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach } from "vitest";

import { toast } from "./src/components/sonner";
import { ThemeProvider } from "./src/theme/theme-provider";

// Testing Library turns React's act environment on only when vitest runs with
// globals, which this package does not use. Without it, a state update that
// escapes act() passes silently instead of warning.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Runs after every test in the package. Components and providers write to
// localStorage and to <html> (the dark class, color-scheme, data-accent,
// data-motion, data-reduced-motion), so each test starts from a blank page.
afterEach(() => {
  // Sonner keeps toasts in module state, and a newly mounted Toaster replays
  // any that are still open: dismiss them all so none leaks into the next test.
  act(() => {
    toast.dismiss();
  });
  cleanup();
  // A file can opt into the node environment (// @vitest-environment node),
  // where there is no page to reset.
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.clear();
  // ThemeProvider keeps the last choice in module state, and only a mounted
  // provider's storage listener clears it. Mount one briefly and send the
  // event, so nothing leaks even when a test unmounted its own provider.
  render(createElement(ThemeProvider, null, null));
  act(() => {
    window.dispatchEvent(new StorageEvent("storage"));
  });
  cleanup();
  const html = document.documentElement;
  html.removeAttribute("class");
  html.removeAttribute("style");
  for (const name of html.getAttributeNames()) {
    if (name.startsWith("data-")) html.removeAttribute(name);
  }
});
