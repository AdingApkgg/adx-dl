import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach } from "vitest";

import { ThemeProvider } from "./src/theme/theme-provider";

// Runs after every test in the package. Components and providers write to
// localStorage and to <html> (the dark class, color-scheme, data-accent,
// data-motion, data-reduced-motion), so each test starts from a blank page.
afterEach(() => {
  cleanup();
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
